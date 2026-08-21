import type { Page, Route } from '@playwright/test';

/**
 * Site-absolute path, including the deployment base.
 *
 * Playwright resolves a relative URL with `new URL(path, baseURL)`, and a leading slash
 * replaces the *entire* path — so `goto('/ar')` against a baseURL of
 * `http://127.0.0.1:4321/dheys-cms` requests `http://127.0.0.1:4321/ar`, which does not
 * exist. Every navigation goes through here instead.
 *
 * This is the same class of mistake the base-path unit tests exist to catch, arriving from
 * the other direction: the application got it right and the test harness got it wrong.
 */
export const BASE_PREFIX = (() => {
  const base = process.env.BASE_PATH ?? '/dheys-cms';
  return base === '/' ? '' : base;
})();

export function at(path: string): string {
  return `${BASE_PREFIX}${path}`;
}

/**
 * Wait for the admin island to become interactive.
 *
 * The connect screen is server-rendered, so it *looks* ready before Preact has hydrated.
 * Clicking the button in that window submits the form for real: `preventDefault` has not
 * been attached yet, the page navigates, and the status message the test is waiting for
 * never appears. Astro marks an island as hydrated by removing its `ssr` attribute.
 */
export async function waitForIsland(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const island = document.querySelector('astro-island');
    return island !== null && !island.hasAttribute('ssr');
  });
}

/**
 * Network isolation for the end-to-end suite.
 *
 * The brief's rule is absolute: no test may call a real AI provider or the real GitHub
 * API. `blockEverythingExternal` enforces it by *failing* rather than by allowing —
 * anything the page requests beyond its own origin aborts the route and records the URL,
 * so a test that would have leaked out fails loudly instead of quietly hitting the network
 * on somebody's laptop.
 *
 * That inversion matters. A mock that only intercepts the URLs you remembered still lets
 * the ones you forgot through.
 */

export interface NetworkGuard {
  /** Every off-origin URL the page tried to reach. Should stay empty. */
  readonly escaped: string[];
}

const ALWAYS_LOCAL = ['localhost', '127.0.0.1'];

/**
 * Wrap a route handler so it tolerates the page having gone away, and nothing else.
 *
 * A route handler runs asynchronously alongside the test. When the test ends, Playwright
 * disposes the context, and a request still in flight fails its `fulfill`, `continue` or
 * `abort` with "Target page, context or browser has been closed" — or, when the response
 * object is disposed mid-call, "Object with guid response@… was not bound in the
 * connection". Neither says anything about the product: the page that would have received
 * the response no longer exists.
 *
 * Only those two are swallowed. Anything else is rethrown, because a route handler that
 * quietly ate real errors would turn a broken mock into a passing test — a worse failure
 * than the flake this removes.
 *
 * Found when one admin test out of forty-four failed inside the release-verification clone
 * under full parallel load, and passed every time in isolation.
 */
function tolerateClosedPage(
  handler: (route: Route) => Promise<void>,
): (route: Route) => Promise<void> {
  return async (route: Route) => {
    try {
      await handler(route);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const pageIsGone =
        message.includes('has been closed') || message.includes('was not bound in the connection');
      if (!pageIsGone) throw error;
    }
  };
}

export async function blockEverythingExternal(page: Page): Promise<NetworkGuard> {
  const escaped: string[] = [];

  await page.route(
    '**/*',
    tolerateClosedPage(async (route: Route) => {
      const url = new URL(route.request().url());

      if (ALWAYS_LOCAL.includes(url.hostname)) {
        await route.continue();
        return;
      }

      escaped.push(url.href);
      await route.abort('blockedbyclient');
    }),
  );

  return { escaped };
}

/* ------------------------------------------------------------------ *
 * GitHub API
 * ------------------------------------------------------------------ */

export interface GitHubMockOptions {
  /** Identity `GET /user` resolves to. Omit to make the token be rejected. */
  readonly login?: string;
  /** Files the mock repository holds, keyed by path. */
  readonly files?: Readonly<Record<string, string>>;
}

export interface GitHubMock {
  /** Every request the page made, in order. */
  readonly requests: Array<{ method: string; path: string; body?: unknown }>;
  /** Files as they stand after any writes the test performed. */
  readonly files: Record<string, string>;
}

/**
 * A small, honest stand-in for api.github.com.
 *
 * It answers the handful of endpoints the admin actually uses and records everything, so
 * a test can assert on the *commit path* — that the admin sent a PUT to the right path,
 * with the right branch, carrying the blob sha it read. That is the property worth
 * pinning; the exact JSON GitHub returns is not.
 */
export async function mockGitHub(page: Page, options: GitHubMockOptions = {}): Promise<GitHubMock> {
  const mock: GitHubMock = { requests: [], files: { ...(options.files ?? {}) } };

  await page.route(
    'https://api.github.com/**',
    tolerateClosedPage(async (route: Route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      const method = request.method();

      let body: unknown;
      if (method !== 'GET') {
        try {
          body = request.postDataJSON() as unknown;
        } catch {
          body = undefined;
        }
      }
      mock.requests.push({ method, path, ...(body === undefined ? {} : { body }) });

      const authorised = (request.headers()['authorization'] ?? '').startsWith('Bearer ');

      if (!authorised || !options.login) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Bad credentials' }),
        });
        return;
      }

      if (path === '/user' && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ login: options.login, name: 'Example Editor', avatar_url: '' }),
        });
        return;
      }

      const contents = /^\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/.exec(path);
      if (contents) {
        const filePath = decodeURIComponent(contents[1] ?? '');

        if (method === 'GET') {
          const text = mock.files[filePath];

          /*
           * A directory listing, which is a different response shape entirely: the contents
           * API returns an array for a directory and an object for a file. The admin reads a
           * locale directory before it can read anything in it, so a mock that only answers
           * files leaves every list empty and every "not found" looks like a UI bug.
           */
          if (text === undefined) {
            const prefix = `${filePath.replace(/\/$/, '')}/`;
            const children = Object.keys(mock.files).filter(
              (candidate) =>
                candidate.startsWith(prefix) && !candidate.slice(prefix.length).includes('/'),
            );

            if (children.length > 0) {
              await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(
                  children.map((candidate) => ({
                    type: 'file',
                    name: candidate.slice(prefix.length),
                    path: candidate,
                    sha: shaFor(mock.files[candidate] ?? ''),
                    size: (mock.files[candidate] ?? '').length,
                  })),
                ),
              });
              return;
            }

            await route.fulfill({
              status: 404,
              contentType: 'application/json',
              body: JSON.stringify({ message: 'Not Found' }),
            });
            return;
          }
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              type: 'file',
              path: filePath,
              sha: shaFor(text),
              size: text.length,
              encoding: 'base64',
              content: Buffer.from(text, 'utf8').toString('base64'),
            }),
          });
          return;
        }

        if (method === 'PUT') {
          const payload = body as { content?: string; sha?: string };
          const decoded = Buffer.from(payload.content ?? '', 'base64').toString('utf8');

          // Reject a stale sha, exactly as GitHub does. An admin that ignores this silently
          // overwrites somebody else's edit.
          const existing = mock.files[filePath];
          if (existing !== undefined && payload.sha !== shaFor(existing)) {
            await route.fulfill({
              status: 409,
              contentType: 'application/json',
              body: JSON.stringify({ message: 'is at a different sha' }),
            });
            return;
          }

          mock.files[filePath] = decoded;
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              content: { path: filePath, sha: shaFor(decoded) },
              commit: { sha: 'commit-sha', html_url: 'https://github.com/nazilafeef/dheys-cms' },
            }),
          });
          return;
        }
      }

      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Not Found' }),
      });
    }),
  );

  return mock;
}

/** Deterministic stand-in for a blob sha. Only needs to be stable and content-derived. */
function shaFor(text: string): string {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (Math.imul(hash, 31) + text.charCodeAt(index)) | 0;
  }
  return `sha-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/* ------------------------------------------------------------------ *
 * Console
 * ------------------------------------------------------------------ */

export interface ConsoleWatch {
  readonly errors: string[];
  readonly warnings: string[];
}

/**
 * Collect console output.
 *
 * The brief requires zero console errors *or warnings* on any page, so both are recorded.
 * Deliberately unfiltered: an allowlist here is how "zero console errors" quietly becomes
 * "zero console errors we decided to care about".
 */
export function watchConsole(page: Page): ConsoleWatch {
  const watch: ConsoleWatch = { errors: [], warnings: [] };

  page.on('console', (message) => {
    if (message.type() === 'error') watch.errors.push(message.text());
    if (message.type() === 'warning') watch.warnings.push(message.text());
  });

  page.on('pageerror', (error) => {
    watch.errors.push(error.message);
  });

  return watch;
}
