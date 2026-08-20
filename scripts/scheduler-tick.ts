/**
 * The scheduler.
 *
 * Runs as a cron GitHub Action. One tick:
 *
 *   1. read the kill switch, and stop if it is on
 *   2. load the registry from wherever the operator put it
 *   3. for each site, read its content directory through the GitHub API
 *   4. validate every item, evaluate its guardrails, and decide with `tick()`
 *   5. commit what is due, then trigger that site's deploy adapter
 *
 * The decision logic is not here -- it is in `src/lib/scheduler.ts`, pure and tested. This
 * file is the part that touches the world: reading, committing, deploying and reporting.
 * Keeping the two apart is what makes idempotency and missed-window catch-up testable
 * without a network.
 *
 *   pnpm scheduler:tick              # act
 *   pnpm scheduler:tick --dry-run    # decide and report, commit nothing
 */
import { GitHubClient, GitHubError } from '../src/lib/github';
import { loadRegistry, guardrailsFor, type SiteDefinition } from '../src/lib/site-registry';
import { registrySourceFromEnv, githubRegistryFetcher } from '../src/lib/runner-env';
import { parseDocument, serialiseDocument } from '../src/lib/frontmatter';
import { postSchema, type Post } from '../src/lib/schemas';
import { transition } from '../src/lib/editorial';
import { mayPublish } from '../src/lib/guardrails';
import { tick, type Decision, type QueueEntry } from '../src/lib/scheduler';
import { deployAndConfirm } from '../src/lib/deploy-adapters';
import type { LocaleCode } from '../src/lib/i18n';

const dryRun = process.argv.includes('--dry-run');
const now = new Date();

/** The repository variable that halts all automated publishing, everywhere, at once. */
const KILL_SWITCH_VARIABLE = 'DHEYS_PUBLISHING_HALTED';

interface SiteOutcome {
  readonly siteId: string;
  readonly decisions: readonly Decision[];
  readonly published: readonly string[];
  readonly deploy?: string;
  readonly error?: string;
}

async function main(): Promise<void> {
  const token = requireEnv('GITHUB_TOKEN');
  const client = new GitHubClient({ token, userAgent: 'dheys-cms-scheduler' });

  const controlRepo = requireEnv('GITHUB_REPOSITORY');
  const [controlOwner = '', controlName = ''] = controlRepo.split('/');

  /*
   * The kill switch is read first and honoured absolutely. It is a repository *variable*
   * rather than a workflow edit so an operator can stop every site publishing in seconds,
   * from a settings page, with no redeploy and no commit.
   */
  const halted = await readKillSwitch(client, controlOwner, controlName);
  if (halted) {
    console.log(`Kill switch (${KILL_SWITCH_VARIABLE}) is on. Nothing will publish on any site.`);
    if (!dryRun) return;
    console.log('Continuing in dry-run mode to report what is being held back.\n');
  }

  const registry = await loadRegistry(
    registrySourceFromEnv(process.env),
    githubRegistryFetcher(client),
  );

  const outcomes: SiteOutcome[] = [];
  for (const site of registry.sites) {
    outcomes.push(
      await runSite(client, site, {
        killSwitch: halted,
        defaultTimezone: site.publishing.defaultTimezone || registry.defaultTimezone,
      }),
    );
  }

  report(outcomes);

  // A tick that could not read a site is a failure worth failing the workflow for: silent
  // no-ops are how a scheduler stops working for a fortnight before anyone notices.
  if (outcomes.some((outcome) => outcome.error)) process.exitCode = 1;
}

async function runSite(
  client: GitHubClient,
  site: SiteDefinition,
  options: { killSwitch: boolean; defaultTimezone: string },
): Promise<SiteOutcome> {
  try {
    const entries = await readQueue(client, site);

    const result = tick({
      now,
      entries,
      killSwitch: options.killSwitch,
      // The ledger is the site's own content: an item whose committed state is already
      // `published` is the durable record that it went out. There is no separate database
      // to fall out of step with the repository.
      publishedLedger: [],
      defaultTimezone: options.defaultTimezone,
    });

    const published: string[] = [];

    if (!dryRun) {
      for (const decision of result.toPublish) {
        const entry = entries.find((candidate) => candidate.id === decision.id);
        if (!entry) continue;
        await publishItem(client, site, entry, decision);
        published.push(entry.item.slug);
      }
    }

    let deploy: string | undefined;
    if (published.length > 0) {
      const outcome = await deployAndConfirm({
        site,
        env: process.env,
        fetchImpl: fetch,
        github: client,
        now,
      });
      deploy = `${outcome.ok ? 'ok' : 'FAILED'}${outcome.confirmed ? ' (confirmed)' : ' (delivery only)'}: ${outcome.detail}`;
    }

    return {
      siteId: site.id,
      decisions: result.decisions,
      published,
      ...(deploy ? { deploy } : {}),
    };
  } catch (error) {
    return {
      siteId: site.id,
      decisions: [],
      published: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Read a site's content directory and build the queue.
 *
 * Only items that could conceivably publish are fetched: an archive of ten thousand
 * published articles must not cost ten thousand API calls on every tick.
 */
async function readQueue(client: GitHubClient, site: SiteDefinition): Promise<QueueEntry[]> {
  const entries: QueueEntry[] = [];

  for (const locale of site.locales) {
    const directory = `${site.contentDir}/posts/${locale}`;
    let files;
    try {
      files = await client.listDirectory(
        site.repo.owner,
        site.repo.name,
        directory,
        site.repo.branch,
      );
    } catch (error) {
      // A locale with no directory yet is normal, not an error.
      if (error instanceof GitHubError && error.status === 404) continue;
      throw error;
    }

    for (const file of files) {
      if (file.type !== 'file' || !/\.mdx?$/.test(file.name)) continue;

      const { text } = await client.getFile(
        site.repo.owner,
        site.repo.name,
        file.path,
        site.repo.branch,
      );
      const document = parseDocument(text);
      const parsed = postSchema.safeParse(document.data);

      if (!parsed.success) {
        console.warn(
          `  ${site.id}: skipping ${file.path} — it does not validate: ` +
            parsed.error.issues
              .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
              .join('; '),
        );
        continue;
      }

      const item = parsed.data;
      if (item.state !== 'approved' && item.state !== 'scheduled' && item.state !== 'in-review') {
        continue;
      }

      const verdict = mayPublish(guardrailsFor(site), {
        siteId: site.id,
        siteName: site.name,
        item,
        body: document.body,
        availableLocales: site.locales as readonly LocaleCode[],
        messageLocale: 'en',
      });

      entries.push({
        id: `${site.id}/${item.locale}/${item.slug}`,
        siteId: site.id,
        item,
        body: document.body,
        guardrailsPassed: verdict.allowed,
        guardrailMessages: verdict.violations.map((violation) => violation.message),
        // Carried so the commit step knows where the file lives without re-deriving it.
        path: file.path,
      });
    }
  }

  return entries;
}

/** Move an item to `published` and commit it. The commit is the publication. */
async function publishItem(
  client: GitHubClient,
  site: SiteDefinition,
  entry: QueueEntry,
  decision: Decision,
): Promise<void> {
  const path = entry.path ?? `${site.contentDir}/posts/${entry.item.locale}/${entry.item.slug}.md`;

  const current = await client.getFile(site.repo.owner, site.repo.name, path, site.repo.branch);
  const document = parseDocument(current.text);

  const moved = transition(
    entry.item,
    'published',
    { kind: 'system', id: 'scheduler' },
    {
      at: now,
      ...(decision.autoApproved
        ? { note: 'Review deadline lapsed with no decision; auto-published by policy.' }
        : {}),
    },
  );

  const updated = serialiseDocument(
    { ...document.data, state: moved.state, transitions: moved.transitions },
    document.body,
  );

  await client.putFile({
    owner: site.repo.owner,
    repo: site.repo.name,
    path,
    branch: site.repo.branch,
    message: buildCommitMessage(moved, decision),
    content: updated,
    // The blob sha of the version just read. Omitting it silently overwrites a concurrent
    // edit; a stale one makes GitHub return 409, which is the correct outcome.
    sha: current.sha,
  });
}

function buildCommitMessage(item: Post, decision: Decision): string {
  const lines = [
    `publish: ${item.title}`,
    '',
    `Published by the Dheys scheduler at ${now.toISOString()}.`,
    `Due ${decision.dueAt.toISOString()}.`,
  ];
  if (decision.late) lines.push(`Late by ${decision.lateBySeconds}s (missed window caught up).`);
  if (decision.autoApproved) {
    lines.push('Auto-published: the review deadline lapsed with no human decision.');
  }
  if (item.provenance) {
    lines.push(
      '',
      `Written by ${item.provenance.model} (${item.provenance.provider}), run ${item.provenance.runId}.`,
      `Cost $${item.provenance.costUsd.toFixed(4)}, ${item.provenance.tokensIn} in / ${item.provenance.tokensOut} out.`,
    );
  }
  return lines.join('\n');
}

async function readKillSwitch(client: GitHubClient, owner: string, repo: string): Promise<boolean> {
  try {
    const value = await client.getVariable(owner, repo, KILL_SWITCH_VARIABLE);
    return value === 'true' || value === '1';
  } catch (error) {
    /*
     * Fail closed. If the switch cannot be read, assume it is on: publishing something an
     * operator has halted is a far worse outcome than publishing it one tick later.
     */
    console.error(
      `Could not read ${KILL_SWITCH_VARIABLE}: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error('Treating the kill switch as ON. Nothing will publish this tick.');
    return true;
  }
}

function report(outcomes: readonly SiteOutcome[]): void {
  console.log(`\nDheys scheduler tick — ${now.toISOString()}${dryRun ? ' (dry run)' : ''}\n`);

  for (const outcome of outcomes) {
    console.log(`  ${outcome.siteId}`);
    if (outcome.error) {
      console.log(`    ERROR: ${outcome.error}`);
      continue;
    }
    if (outcome.decisions.length === 0) {
      console.log('    nothing queued');
    }
    for (const decision of outcome.decisions) {
      console.log(`    [${decision.action}] ${decision.id} — ${decision.reason}`);
    }
    if (outcome.deploy) console.log(`    deploy: ${outcome.deploy}`);
    console.log('');
  }

  const total = outcomes.reduce((sum, outcome) => sum + outcome.published.length, 0);
  console.log(dryRun ? 'Dry run: nothing was committed.' : `Published ${total} item(s).`);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set. The scheduler cannot run without it.`);
    process.exit(1);
  }
  return value;
}

await main();
