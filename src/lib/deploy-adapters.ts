import type { FetchLike, GitHubClient, WorkflowRun } from './github';
import type { DeployAdapterConfig, SiteDefinition } from './site-registry';

/**
 * Deploy adapters.
 *
 * Only the control plane lives on GitHub Pages. A connected site can be anywhere, so
 * publishing has two halves: commit the content, then make the target actually rebuild.
 *
 * The distinction this module insists on is between *triggered* and *confirmed*. A deploy
 * hook returning 200 means the host accepted the request, not that the site rebuilt, not
 * that the build passed, and certainly not that the article is live. The scheduler needs
 * to know which of those it has, so every outcome carries `confirmed` and every adapter
 * says plainly what it was able to verify. Reporting "deployed" on the strength of a 200
 * is the failure this design exists to avoid.
 *
 * Secrets are never held here. The registry stores the *names* of environment variables;
 * the values live in Actions secrets and are read inside the runner.
 */

export type DeployEnv = Readonly<Record<string, string | undefined>>;

export interface DeployContext {
  readonly site: SiteDefinition;
  readonly env: DeployEnv;
  readonly fetchImpl: FetchLike;
  /** Required by the github-pages adapter; unused by the others. */
  readonly github?: GitHubClient;
  readonly now: Date;
  /** Injected so polling is instant in tests and real in a runner. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface DeployHandle {
  readonly adapter: DeployAdapterConfig['kind'];
  /** Host-side identifier, when the host gave one back. */
  readonly id?: string;
  readonly url?: string;
}

export interface DeployOutcome {
  readonly ok: boolean;
  readonly adapter: DeployAdapterConfig['kind'];
  /**
   * True only when the adapter verified the build finished. False means the trigger was
   * accepted but the result is unknown -- which is a different thing from success.
   */
  readonly confirmed: boolean;
  readonly detail: string;
  readonly handle?: DeployHandle;
}

export interface ConfirmOptions {
  /** Give up after this long. A stuck build must not hang a scheduler tick forever. */
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 10_000;

/* ------------------------------------------------------------------ *
 * Public surface
 * ------------------------------------------------------------------ */

/** Kick off a deploy. Returns a handle the confirm step can follow. */
export async function triggerDeploy(ctx: DeployContext): Promise<DeployOutcome> {
  const config = ctx.site.deploy;
  switch (config.kind) {
    case 'github-pages':
      return triggerGitHubPages(ctx, config);
    case 'cloudflare-pages':
      return triggerCloudflarePages(ctx, config);
    case 'netlify':
      return triggerNetlify(ctx, config);
    case 'vercel':
      return triggerVercel(ctx, config);
    case 'webhook':
      return triggerWebhook(ctx, config);
  }
}

/** Trigger, then wait for a real answer where the host makes one available. */
export async function deployAndConfirm(
  ctx: DeployContext,
  options: ConfirmOptions = {},
): Promise<DeployOutcome> {
  const triggered = await triggerDeploy(ctx);
  if (!triggered.ok || !triggered.handle) return triggered;

  const config = ctx.site.deploy;
  switch (config.kind) {
    case 'github-pages':
      return confirmGitHubPages(ctx, triggered.handle, options);
    case 'cloudflare-pages':
      return confirmCloudflarePages(ctx, config, triggered.handle, options);
    case 'netlify':
      return confirmNetlify(ctx, config, triggered.handle, options);
    case 'vercel':
      return confirmVercel(ctx, triggered.handle, options);
    case 'webhook':
      return triggered; // a generic webhook exposes nothing to poll
  }
}

/* ------------------------------------------------------------------ *
 * GitHub Pages
 * ------------------------------------------------------------------ */

async function triggerGitHubPages(
  ctx: DeployContext,
  config: Extract<DeployAdapterConfig, { kind: 'github-pages' }>,
): Promise<DeployOutcome> {
  if (!ctx.github) {
    return fail('github-pages', 'No authenticated GitHub client was supplied.');
  }
  const { owner, name } = ctx.site.repo;
  try {
    await ctx.github.dispatchWorkflow(owner, name, config.workflow, config.ref);
  } catch (error) {
    return fail('github-pages', message(error));
  }
  return {
    ok: true,
    adapter: 'github-pages',
    confirmed: false,
    detail: `Dispatched ${config.workflow} on ${owner}/${name}@${config.ref}.`,
    handle: { adapter: 'github-pages', id: config.workflow },
  };
}

async function confirmGitHubPages(
  ctx: DeployContext,
  handle: DeployHandle,
  options: ConfirmOptions,
): Promise<DeployOutcome> {
  const github = ctx.github;
  if (!github) return fail('github-pages', 'No authenticated GitHub client was supplied.');
  const { owner, name } = ctx.site.repo;
  const workflow = handle.id;

  const found = await poll<WorkflowRun>(ctx, options, async () => {
    const runs = await github.listWorkflowRuns(owner, name, {
      ...(workflow ? { workflow } : {}),
      perPage: 5,
    });
    // Only consider runs that started at or after the dispatch, so a previous run's
    // success is never mistaken for this one's.
    const candidate = runs.find(
      (run) => new Date(run.created_at).getTime() >= ctx.now.getTime() - 60_000,
    );
    if (!candidate) return undefined;
    return candidate.status === 'completed' ? candidate : undefined;
  });

  if (!found) {
    return {
      ok: false,
      adapter: 'github-pages',
      confirmed: false,
      detail: `Dispatched, but no completed run appeared within the timeout. The build may still be running — check ${owner}/${name} Actions.`,
      handle,
    };
  }

  const ok = found.conclusion === 'success';
  return {
    ok,
    adapter: 'github-pages',
    confirmed: true,
    detail: ok
      ? `Build ${found.id} succeeded.`
      : `Build ${found.id} finished with conclusion "${found.conclusion}". ${found.html_url}`,
    handle: { adapter: 'github-pages', id: String(found.id), url: found.html_url },
  };
}

/* ------------------------------------------------------------------ *
 * Cloudflare Pages
 * ------------------------------------------------------------------ */

async function triggerCloudflarePages(
  ctx: DeployContext,
  config: Extract<DeployAdapterConfig, { kind: 'cloudflare-pages' }>,
): Promise<DeployOutcome> {
  const hook = ctx.env[config.deployHookEnv];
  if (!hook) return missingEnv('cloudflare-pages', config.deployHookEnv);

  const response = await safePost(ctx, hook);
  if (!response.ok) {
    return fail('cloudflare-pages', `Deploy hook returned HTTP ${response.status}.`);
  }

  const payload = parseJson<{ result?: { id?: string }; success?: boolean }>(response.body);
  const id = payload?.result?.id;
  return {
    ok: true,
    adapter: 'cloudflare-pages',
    confirmed: false,
    detail: id
      ? `Deploy hook accepted; Cloudflare deployment ${id} queued.`
      : 'Deploy hook accepted. Cloudflare returned no deployment id, so completion cannot be confirmed.',
    handle: { adapter: 'cloudflare-pages', ...(id ? { id } : {}) },
  };
}

async function confirmCloudflarePages(
  ctx: DeployContext,
  config: Extract<DeployAdapterConfig, { kind: 'cloudflare-pages' }>,
  handle: DeployHandle,
  options: ConfirmOptions,
): Promise<DeployOutcome> {
  const token = ctx.env['CLOUDFLARE_API_TOKEN'];
  const account = ctx.env['CLOUDFLARE_ACCOUNT_ID'];
  const project = config.projectNameEnv ? ctx.env[config.projectNameEnv] : undefined;

  if (!token || !account || !project || !handle.id) {
    return unconfirmable(
      'cloudflare-pages',
      'CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID and a project name',
      handle,
    );
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${project}/deployments/${handle.id}`;
  const state = await poll<string>(ctx, options, async () => {
    const response = await safeGet(ctx, url, { Authorization: `Bearer ${token}` });
    if (!response.ok) return undefined;
    const payload = parseJson<{ result?: { latest_stage?: { name?: string; status?: string } } }>(
      response.body,
    );
    const stage = payload?.result?.latest_stage;
    if (!stage?.status) return undefined;
    if (stage.status === 'success' || stage.status === 'failure' || stage.status === 'canceled') {
      return `${stage.name ?? 'deploy'}:${stage.status}`;
    }
    return undefined;
  });

  if (!state) return timedOut('cloudflare-pages', handle);
  const ok = state.endsWith(':success');
  return {
    ok,
    adapter: 'cloudflare-pages',
    confirmed: true,
    detail: ok
      ? `Cloudflare deployment ${handle.id} succeeded.`
      : `Cloudflare deployment ${handle.id} ended at ${state}.`,
    handle,
  };
}

/* ------------------------------------------------------------------ *
 * Netlify
 * ------------------------------------------------------------------ */

async function triggerNetlify(
  ctx: DeployContext,
  config: Extract<DeployAdapterConfig, { kind: 'netlify' }>,
): Promise<DeployOutcome> {
  const hook = ctx.env[config.buildHookEnv];
  if (!hook) return missingEnv('netlify', config.buildHookEnv);

  const response = await safePost(ctx, hook);
  if (!response.ok) return fail('netlify', `Build hook returned HTTP ${response.status}.`);

  // Netlify build hooks answer 200 with an empty body and no id. Completion is only
  // observable through the API, which needs a token and the site id.
  return {
    ok: true,
    adapter: 'netlify',
    confirmed: false,
    detail:
      'Build hook accepted. Netlify build hooks return no id, so completion is checked against the deploys API.',
    handle: { adapter: 'netlify' },
  };
}

async function confirmNetlify(
  ctx: DeployContext,
  config: Extract<DeployAdapterConfig, { kind: 'netlify' }>,
  handle: DeployHandle,
  options: ConfirmOptions,
): Promise<DeployOutcome> {
  const token = ctx.env['NETLIFY_AUTH_TOKEN'];
  const siteId = config.siteIdEnv ? ctx.env[config.siteIdEnv] : undefined;
  if (!token || !siteId) {
    return unconfirmable('netlify', 'NETLIFY_AUTH_TOKEN and a site id', handle);
  }

  const url = `https://api.netlify.com/api/v1/sites/${siteId}/deploys?per_page=1`;
  const state = await poll<{ state: string; id: string }>(ctx, options, async () => {
    const response = await safeGet(ctx, url, { Authorization: `Bearer ${token}` });
    if (!response.ok) return undefined;
    const payload = parseJson<Array<{ state?: string; id?: string; created_at?: string }>>(
      response.body,
    );
    const latest = payload?.[0];
    if (!latest?.state || !latest.id) return undefined;
    if (latest.created_at && new Date(latest.created_at).getTime() < ctx.now.getTime() - 60_000) {
      return undefined; // an older deploy, not the one just triggered
    }
    if (latest.state === 'ready' || latest.state === 'error') {
      return { state: latest.state, id: latest.id };
    }
    return undefined;
  });

  if (!state) return timedOut('netlify', handle);
  const ok = state.state === 'ready';
  return {
    ok,
    adapter: 'netlify',
    confirmed: true,
    detail: ok ? `Netlify deploy ${state.id} is live.` : `Netlify deploy ${state.id} failed.`,
    handle: { adapter: 'netlify', id: state.id },
  };
}

/* ------------------------------------------------------------------ *
 * Vercel
 * ------------------------------------------------------------------ */

async function triggerVercel(
  ctx: DeployContext,
  config: Extract<DeployAdapterConfig, { kind: 'vercel' }>,
): Promise<DeployOutcome> {
  const hook = ctx.env[config.deployHookEnv];
  if (!hook) return missingEnv('vercel', config.deployHookEnv);

  const response = await safePost(ctx, hook);
  if (!response.ok) return fail('vercel', `Deploy hook returned HTTP ${response.status}.`);

  const payload = parseJson<{ job?: { id?: string; state?: string } }>(response.body);
  const id = payload?.job?.id;
  return {
    ok: true,
    adapter: 'vercel',
    confirmed: false,
    detail: id ? `Deploy hook accepted; job ${id} queued.` : 'Deploy hook accepted.',
    handle: { adapter: 'vercel', ...(id ? { id } : {}) },
  };
}

async function confirmVercel(
  ctx: DeployContext,
  handle: DeployHandle,
  options: ConfirmOptions,
): Promise<DeployOutcome> {
  const token = ctx.env['VERCEL_TOKEN'];
  if (!token) return unconfirmable('vercel', 'VERCEL_TOKEN', handle);

  const url = 'https://api.vercel.com/v6/deployments?limit=1';
  const state = await poll<{ state: string; uid: string }>(ctx, options, async () => {
    const response = await safeGet(ctx, url, { Authorization: `Bearer ${token}` });
    if (!response.ok) return undefined;
    const payload = parseJson<{
      deployments?: Array<{ state?: string; uid?: string; created?: number }>;
    }>(response.body);
    const latest = payload?.deployments?.[0];
    if (!latest?.state || !latest.uid) return undefined;
    if (latest.created && latest.created < ctx.now.getTime() - 60_000) return undefined;
    if (latest.state === 'READY' || latest.state === 'ERROR' || latest.state === 'CANCELED') {
      return { state: latest.state, uid: latest.uid };
    }
    return undefined;
  });

  if (!state) return timedOut('vercel', handle);
  const ok = state.state === 'READY';
  return {
    ok,
    adapter: 'vercel',
    confirmed: true,
    detail: ok
      ? `Vercel deployment ${state.uid} is ready.`
      : `Vercel deployment ${state.uid} ended in ${state.state}.`,
    handle: { adapter: 'vercel', id: state.uid },
  };
}

/* ------------------------------------------------------------------ *
 * Generic webhook
 * ------------------------------------------------------------------ */

async function triggerWebhook(
  ctx: DeployContext,
  config: Extract<DeployAdapterConfig, { kind: 'webhook' }>,
): Promise<DeployOutcome> {
  const url = ctx.env[config.urlEnv];
  if (!url) return missingEnv('webhook', config.urlEnv);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  for (const [header, envName] of Object.entries(config.headerEnv)) {
    const value = ctx.env[envName];
    if (value) headers[header] = value;
  }

  const response = await safeRequest(ctx, url, config.method, headers, {
    site: ctx.site.id,
    triggeredAt: ctx.now.toISOString(),
  });

  if (!response.ok) return fail('webhook', `Webhook returned HTTP ${response.status}.`);
  return {
    ok: true,
    adapter: 'webhook',
    confirmed: false,
    detail:
      'Webhook accepted the request. A generic webhook exposes nothing to poll, so this reports delivery, not deployment.',
    handle: { adapter: 'webhook', url },
  };
}

/* ------------------------------------------------------------------ *
 * Shared plumbing
 * ------------------------------------------------------------------ */

interface RawResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly body: string;
}

async function safeRequest(
  ctx: DeployContext,
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<RawResponse> {
  try {
    const response = await ctx.fetchImpl(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, body: text };
  } catch (error) {
    return { ok: false, status: 0, body: message(error) };
  }
}

function safePost(ctx: DeployContext, url: string): Promise<RawResponse> {
  return safeRequest(ctx, url, 'POST', { 'Content-Type': 'application/json' }, {});
}

function safeGet(
  ctx: DeployContext,
  url: string,
  headers: Record<string, string>,
): Promise<RawResponse> {
  return safeRequest(ctx, url, 'GET', headers);
}

function parseJson<T>(text: string): T | undefined {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/** Poll until `check` returns a value or the timeout elapses. */
async function poll<T>(
  ctx: DeployContext,
  options: ConfirmOptions,
  check: () => Promise<T | undefined>,
): Promise<T | undefined> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const sleep =
    ctx.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const result = await check();
    if (result !== undefined) return result;
    if (Date.now() >= deadline) return undefined;
    await sleep(intervalMs);
  }
}

function fail(adapter: DeployAdapterConfig['kind'], detail: string): DeployOutcome {
  return { ok: false, adapter, confirmed: false, detail };
}

function missingEnv(adapter: DeployAdapterConfig['kind'], name: string): DeployOutcome {
  return fail(
    adapter,
    `Environment variable ${name} is not set in this runner. The registry names it; the value belongs in Actions secrets.`,
  );
}

function unconfirmable(
  adapter: DeployAdapterConfig['kind'],
  needs: string,
  handle: DeployHandle,
): DeployOutcome {
  return {
    ok: true,
    adapter,
    confirmed: false,
    detail: `Deploy was triggered, but completion cannot be checked without ${needs}. Reporting delivery, not deployment.`,
    handle,
  };
}

function timedOut(adapter: DeployAdapterConfig['kind'], handle: DeployHandle): DeployOutcome {
  return {
    ok: false,
    adapter,
    confirmed: false,
    detail: 'Deploy was triggered but did not reach a final state within the timeout.',
    handle,
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
