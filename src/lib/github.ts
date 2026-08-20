/**
 * GitHub API client.
 *
 * This is the only thing in the control plane that talks to a network. The admin runs it
 * in a browser with a session-scoped fine-grained PAT; the scheduler and agent runner run
 * it in an Actions runner with the workflow token. Same code, same error handling.
 *
 * `fetch` is injected rather than reached for globally. That is not ceremony: the brief
 * forbids any test from calling the real GitHub API, and injecting the transport is what
 * makes that enforceable instead of aspirational.
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface FetchLike {
  (input: string, init?: RequestInit): Promise<Response>;
}

export interface GitHubClientOptions {
  readonly token: string;
  readonly fetchImpl?: FetchLike;
  readonly baseUrl?: string;
  /** Sent in User-Agent. GitHub rejects requests without one. */
  readonly userAgent?: string;
}

export class GitHubError extends Error {
  readonly status: number;
  readonly path: string;
  /** GitHub's own message, when it sent one. */
  readonly apiMessage: string | undefined;

  constructor(status: number, path: string, apiMessage: string | undefined) {
    super(GitHubError.describe(status, path, apiMessage));
    this.name = 'GitHubError';
    this.status = status;
    this.path = path;
    this.apiMessage = apiMessage;
  }

  /**
   * Turn a status code into something an operator can act on. A bare "401" tells a
   * non-technical editor nothing; "your token does not cover this repository" tells them
   * what to change.
   */
  private static describe(status: number, path: string, apiMessage: string | undefined): string {
    const suffix = apiMessage ? ` GitHub said: ${apiMessage}` : '';
    switch (status) {
      case 401:
        return `The access token was rejected. It may have expired, or been revoked.${suffix}`;
      case 403:
        return `The token is valid but not permitted to do this (${path}). A fine-grained token must list this repository and grant Contents: read and write, plus Actions: read and write for scheduling.${suffix}`;
      case 404:
        return `Not found: ${path}. For a private repository a 404 usually means the token cannot see it, rather than that it does not exist.${suffix}`;
      case 409:
        return `Conflict at ${path}. The file changed since it was read — reload and reapply the edit.${suffix}`;
      case 422:
        return `GitHub rejected the request body for ${path}.${suffix}`;
      default:
        return `GitHub request to ${path} failed with HTTP ${status}.${suffix}`;
    }
  }
}

export interface RateLimit {
  readonly remaining: number | null;
  readonly limit: number | null;
  readonly resetAt: Date | null;
}

export interface GitHubUser {
  readonly login: string;
  readonly name: string | null;
  readonly avatar_url: string;
}

export interface RepoContentFile {
  readonly type: 'file';
  readonly path: string;
  readonly sha: string;
  readonly size: number;
  readonly content: string;
  readonly encoding: 'base64' | 'none';
}

export interface RepoContentEntry {
  readonly type: 'file' | 'dir' | 'symlink' | 'submodule';
  readonly name: string;
  readonly path: string;
  readonly sha: string;
  readonly size: number;
}

export interface CommitResult {
  readonly content: { readonly path: string; readonly sha: string } | null;
  readonly commit: { readonly sha: string; readonly html_url: string };
}

export interface WorkflowRun {
  readonly id: number;
  readonly name: string | null;
  readonly status: 'queued' | 'in_progress' | 'completed' | string;
  readonly conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | 'timed_out' | null;
  readonly html_url: string;
  readonly created_at: string;
  readonly head_sha: string;
}

export class GitHubClient {
  private readonly token: string;
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private lastRateLimit: RateLimit = { remaining: null, limit: null, resetAt: null };

  constructor(options: GitHubClientOptions) {
    if (!options.token) throw new Error('A GitHub token is required.');
    this.token = options.token;
    const injected = options.fetchImpl;
    if (injected) {
      this.fetchImpl = injected;
    } else if (typeof globalThis.fetch === 'function') {
      this.fetchImpl = globalThis.fetch.bind(globalThis) as FetchLike;
    } else {
      throw new Error('No fetch implementation available. Pass fetchImpl explicitly.');
    }
    this.baseUrl = options.baseUrl ?? 'https://api.github.com';
    this.userAgent = options.userAgent ?? 'dheys-cms';
  }

  get rateLimit(): RateLimit {
    return this.lastRateLimit;
  }

  async request<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${this.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': this.userAgent,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const response = await this.fetchImpl(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    this.readRateLimit(response);

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    if (!response.ok) {
      throw new GitHubError(response.status, path, extractMessage(text));
    }
    if (text === '') return undefined as T;

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new GitHubError(response.status, path, 'response body was not JSON');
    }
  }

  private readRateLimit(response: Response): void {
    const remaining = response.headers?.get?.('x-ratelimit-remaining');
    const limit = response.headers?.get?.('x-ratelimit-limit');
    const reset = response.headers?.get?.('x-ratelimit-reset');
    this.lastRateLimit = {
      remaining: remaining === null || remaining === undefined ? null : Number(remaining),
      limit: limit === null || limit === undefined ? null : Number(limit),
      resetAt: reset === null || reset === undefined ? null : new Date(Number(reset) * 1000),
    };
  }

  /* ---------------- identity ---------------- */

  /**
   * Verify a token by asking who it belongs to.
   *
   * This checks a *configuration value* -- the identity the token actually resolves to --
   * rather than a response shape. A 200 from some other endpoint proves only that a
   * request was answered, not that the credential is the one the operator meant to use.
   */
  async whoAmI(): Promise<GitHubUser> {
    return this.request<GitHubUser>('GET', '/user');
  }

  /* ---------------- contents ---------------- */

  async getFile(
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ): Promise<{ text: string; sha: string }> {
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const file = await this.request<RepoContentFile>(
      'GET',
      `/repos/${owner}/${repo}/contents/${encodePath(path)}${query}`,
    );
    return { text: decodeBase64(file.content), sha: file.sha };
  }

  async listDirectory(
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ): Promise<RepoContentEntry[]> {
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const result = await this.request<RepoContentEntry[] | RepoContentEntry>(
      'GET',
      `/repos/${owner}/${repo}/contents/${encodePath(path)}${query}`,
    );
    return Array.isArray(result) ? result : [result];
  }

  /**
   * Create or update a file.
   *
   * `sha` is the blob sha of the version being replaced. Omitting it on an existing file
   * is how a CMS silently overwrites somebody else's edit; passing a stale one makes
   * GitHub return 409, which is the correct outcome and is surfaced as such.
   */
  async putFile(options: {
    owner: string;
    repo: string;
    path: string;
    message: string;
    content: string;
    branch: string;
    sha?: string;
    committer?: { name: string; email: string };
  }): Promise<CommitResult> {
    return this.request<CommitResult>(
      'PUT',
      `/repos/${options.owner}/${options.repo}/contents/${encodePath(options.path)}`,
      {
        message: options.message,
        content: encodeBase64(options.content),
        branch: options.branch,
        ...(options.sha ? { sha: options.sha } : {}),
        ...(options.committer ? { committer: options.committer } : {}),
      },
    );
  }

  async deleteFile(options: {
    owner: string;
    repo: string;
    path: string;
    message: string;
    sha: string;
    branch: string;
  }): Promise<CommitResult> {
    return this.request<CommitResult>(
      'DELETE',
      `/repos/${options.owner}/${options.repo}/contents/${encodePath(options.path)}`,
      {
        message: options.message,
        sha: options.sha,
        branch: options.branch,
      },
    );
  }

  /* ---------------- actions ---------------- */

  async dispatchWorkflow(
    owner: string,
    repo: string,
    workflow: string,
    ref: string,
    inputs: Record<string, string> = {},
  ): Promise<void> {
    await this.request<void>(
      'POST',
      `/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
      { ref, inputs },
    );
  }

  async repositoryDispatch(
    owner: string,
    repo: string,
    eventType: string,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    await this.request<void>('POST', `/repos/${owner}/${repo}/dispatches`, {
      event_type: eventType,
      client_payload: payload,
    });
  }

  async listWorkflowRuns(
    owner: string,
    repo: string,
    options: { workflow?: string; perPage?: number; branch?: string } = {},
  ): Promise<WorkflowRun[]> {
    const perPage = options.perPage ?? 10;
    const branch = options.branch ? `&branch=${encodeURIComponent(options.branch)}` : '';
    const path = options.workflow
      ? `/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(options.workflow)}/runs?per_page=${perPage}${branch}`
      : `/repos/${owner}/${repo}/actions/runs?per_page=${perPage}${branch}`;
    const result = await this.request<{ workflow_runs: WorkflowRun[] }>('GET', path);
    return result.workflow_runs;
  }

  async getWorkflowRun(owner: string, repo: string, runId: number): Promise<WorkflowRun> {
    return this.request<WorkflowRun>('GET', `/repos/${owner}/${repo}/actions/runs/${runId}`);
  }

  /* ---------------- repository variables ---------------- */

  /** Reads the publishing kill switch, among other things. */
  async getVariable(owner: string, repo: string, name: string): Promise<string | null> {
    try {
      const result = await this.request<{ name: string; value: string }>(
        'GET',
        `/repos/${owner}/${repo}/actions/variables/${encodeURIComponent(name)}`,
      );
      return result.value;
    } catch (error) {
      if (error instanceof GitHubError && error.status === 404) return null;
      throw error;
    }
  }
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function encodePath(path: string): string {
  return path
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function extractMessage(text: string): string | undefined {
  if (text === '') return undefined;
  try {
    const parsed = JSON.parse(text) as { message?: unknown };
    return typeof parsed.message === 'string' ? parsed.message : undefined;
  } catch {
    return text.slice(0, 200);
  }
}

/**
 * Base64 that survives Thaana, Arabic and emoji.
 *
 * `btoa` is byte-oriented and throws on any code point above U+00FF, so encoding a
 * Dhivehi article with it fails outright. Encoding to UTF-8 bytes first is not optional
 * for this CMS.
 */
export function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  if (typeof btoa === 'function') {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
  return Buffer.from(bytes).toString('base64');
}

export function decodeBase64(value: string): string {
  const compact = value.replace(/\s+/g, '');
  if (typeof atob === 'function') {
    const binary = atob(compact);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(compact, 'base64').toString('utf8');
}
