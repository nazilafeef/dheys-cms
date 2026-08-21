/**
 * The agent runner.
 *
 * Dispatched by the admin (through `workflow_dispatch`) or by the commissioning workflow.
 * One run:
 *
 *   1. load the registry and the site
 *   2. estimate the cost and check it against the caps BEFORE calling anything
 *   3. resolve a configured provider and run the job
 *   4. put the result through `intake()` — the same door every provider uses
 *   5. commit an accepted item into the site repo as `in-review`, never as published
 *   6. record what the run actually cost
 *
 * Two properties matter more than anything else here. The cost check happens before
 * dispatch, so a capped site cannot spend by accident. And an accepted item lands in
 * review, not live: this runner has no path that publishes. Publication is the scheduler's
 * job and goes through the guardrails.
 *
 *   pnpm agent:run --site example-news --job write --brief "..." [--locale dv] [--dry-run]
 */
import { GitHubClient } from '../src/lib/github';
import { loadRegistry, findSite, capsFrom } from '../src/lib/site-registry';
import {
  registrySourceFromEnv,
  githubRegistryFetcher,
  apiBaseUrlFromEnv,
} from '../src/lib/runner-env';
import { serialiseDocument } from '../src/lib/frontmatter';
import { intake, agentJobRequestSchema, type AgentJobRequest } from '../src/lib/job-contract';
import { resolveProvider } from '../src/lib/providers';
import {
  checkDispatch,
  estimateCost,
  format as formatUsd,
  type CostLedgerEntry,
} from '../src/lib/cost';
import { transition } from '../src/lib/editorial';
import { DEFAULT_LOCALE, type LocaleCode } from '../src/lib/i18n';

const args = parseArgs(process.argv.slice(2));
const dryRun = args['dry-run'] === 'true';
const now = new Date();

/**
 * Tokens assumed for a job that has not run yet.
 *
 * Estimation before dispatch cannot know the real figure, so it uses a deliberately
 * generous guess. Under-estimating would let a run start that takes a site past its cap,
 * which is the exact thing the cap exists to prevent; over-estimating only ever refuses a
 * run slightly early, and the operator can override.
 */
const ASSUMED_TOKENS_IN = 30_000;
const ASSUMED_TOKENS_OUT = 6_000;

async function main(): Promise<void> {
  const token = requireEnv('GITHUB_TOKEN');
  const client = new GitHubClient({
    token,
    userAgent: 'dheys-cms-agent-runner',
    baseUrl: apiBaseUrlFromEnv(process.env),
  });

  const registry = await loadRegistry(
    registrySourceFromEnv(process.env),
    githubRegistryFetcher(client),
  );

  const siteId = required('site');
  const site = findSite(registry, siteId);

  if (!site.agents.enabled) {
    fail(`Site "${site.id}" has agents disabled in the registry. Nothing was dispatched.`);
  }

  const locale = (args['locale'] ?? site.defaultLocale ?? DEFAULT_LOCALE) as LocaleCode;
  const model = site.agents.defaultModel ?? 'claude-opus-5';

  const request: AgentJobRequest = agentJobRequestSchema.parse({
    runId: args['run-id'] ?? `run-${now.toISOString().replace(/[:.]/g, '-')}`,
    jobType: required('job'),
    siteId: site.id,
    locale,
    brief: required('brief'),
    promptVersion: args['prompt-version'] ?? 'default@1',
    maxCostUsd: Number(args['max-cost'] ?? 2),
    allowedCategories: args['categories']?.split(',').filter(Boolean) ?? [],
    ...(args['target-locale'] ? { targetLocale: args['target-locale'] } : {}),
    ...(args['commission'] ? { commissionId: args['commission'] } : {}),
  });

  /* ---- cost, before anything is spent ---- */

  const ledger = await readLedger(client, site.repo.owner, site.repo.name);
  const estimate = estimateCost({
    model,
    tokensIn: ASSUMED_TOKENS_IN,
    tokensOut: ASSUMED_TOKENS_OUT,
    rates: site.agents.modelRates,
    fallbackUsd: request.maxCostUsd,
  });

  const verdict = checkDispatch({
    caps: capsFrom(registry),
    ledger,
    siteId: site.id,
    estimatedCostUsd: estimate.costUsd,
    now,
    override: args['override'] === 'true',
    timeZone: site.publishing.defaultTimezone,
  });

  console.log(
    `Estimated ${formatUsd(estimate.costUsd)}${estimate.rateKnown ? '' : ' (model has no known rate — using the job ceiling)'}.`,
  );
  console.log(verdict.reason);

  if (!verdict.allowed) {
    // A hard stop. The operator can re-run with --override=true, which is recorded.
    process.exitCode = 1;
    return;
  }

  /* ---- run ---- */

  const provider = resolveProvider(site.agents.providers, process.env);
  console.log(`Dispatching ${request.jobType} to ${provider.label} for ${site.name}.`);

  if (dryRun) {
    console.log('Dry run: no provider was called and nothing was committed.');
    return;
  }

  const result = await provider.run(request, {
    env: process.env,
    fetchImpl: fetch,
    now,
  });

  /* ---- intake ---- */

  const outcome = intake(result);

  if (!outcome.accepted) {
    /*
     * Rejected output is reported and discarded. It is never written to a site repository,
     * even as a draft: a file that failed the contract is a file whose category or date is
     * wrong, and putting it where a build can see it is the failure the contract exists to
     * prevent.
     */
    console.error(`\n${outcome.summary}\n`);
    for (const error of outcome.errors) {
      console.error(`  ${error.field}: ${error.message}`);
    }
    console.error('\nNothing was written to the site repository.');
    process.exitCode = 1;
    return;
  }

  /* ---- commit into review ---- */

  const inReview = transition(
    { ...outcome.item, state: 'drafting' },
    'draft',
    { kind: 'agent', id: outcome.runId },
    { at: now },
  );
  const queued = transition(
    inReview,
    'in-review',
    { kind: 'agent', id: outcome.runId },
    {
      at: now,
      note: `Produced by ${provider.label}. Awaiting review.`,
    },
  );

  const path = `${site.contentDir}/posts/${queued.locale}/${queued.slug}.md`;
  const document = serialiseDocument({ ...queued }, outcome.body);

  await client.putFile({
    owner: site.repo.owner,
    repo: site.repo.name,
    path,
    branch: site.repo.branch,
    message: [
      `draft: ${queued.title}`,
      '',
      `Produced by ${queued.provenance?.model ?? 'an agent'} via ${provider.label}.`,
      `Run ${outcome.runId}, prompt ${request.promptVersion}.`,
      `Cost ${formatUsd(queued.provenance?.costUsd ?? 0)}.`,
      '',
      'State: in-review. This runner never publishes; the scheduler does, after guardrails.',
    ].join('\n'),
    content: document,
  });

  console.log(
    `\nAccepted. Committed to ${site.repo.owner}/${site.repo.name}:${path} as in-review.`,
  );
  console.log(`Real cost: ${formatUsd(queued.provenance?.costUsd ?? 0)}.`);
}

/**
 * The cost ledger.
 *
 * Read from the control repository rather than kept in memory, because caps are monthly
 * and a runner is ephemeral. A missing ledger is an empty one, not an error: the first run
 * of a fresh install has nothing to read.
 */
async function readLedger(
  client: GitHubClient,
  owner: string,
  repo: string,
): Promise<CostLedgerEntry[]> {
  const path = process.env['COST_LEDGER_PATH'] ?? '.dheys/cost-ledger.json';
  try {
    const { text } = await client.getFile(owner, repo, path);
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((entry) => ({
      ...(entry as Omit<CostLedgerEntry, 'at'>),
      at: new Date((entry as { at: string }).at),
    }));
  } catch {
    return [];
  }
}

function parseArgs(argv: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined || !token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = 'true';
    } else {
      out[key] = next;
      index += 1;
    }
  }
  return out;
}

function required(name: string): string {
  const value = args[name];
  if (!value) fail(`--${name} is required.`);
  return value as string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) fail(`${name} is not set.`);
  return value as string;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

await main();
