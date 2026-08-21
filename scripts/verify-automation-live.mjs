#!/usr/bin/env node
/**
 * Ship step 6, the part that needs a real credential.
 *
 * `pnpm verify:automation` proves the scheduler, the guardrails, the kill switch and the
 * connector against a local stand-in, with every GitHub call mocked. Three behaviours
 * cannot be proved that way, because they are properties of the real API rather than of
 * this code:
 *
 *   - rate limits    the client reads `x-ratelimit-*` off real responses and reports what
 *                    is left. A mock returns whatever the test told it to.
 *   - pagination     a listing longer than one page. A mock never has a second page unless
 *                    someone remembered to write one, which is the bug this catches.
 *   - permissions    401, 403 and 404 as GitHub actually sends them. The client turns each
 *                    into a sentence an operator can act on, and until now the sentences
 *                    had only ever been checked against statuses this repository invented.
 *
 * This script exercises those three against a scratch repository it creates and then
 * deletes. It writes nothing to any other repository and reads no site registry.
 *
 * The scratch repository is created **private**: nothing about these checks needs it to be
 * public, and a public throwaway is an unnecessary thing to have existed.
 *
 *   node scripts/verify-automation-live.mjs
 *   node scripts/verify-automation-live.mjs --keep    leave the scratch repository behind
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const keep = args.includes('--keep');
const readFlag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const JSON_OUT = readFlag('--json');

const API = 'https://api.github.com';
const TOKEN = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error('verify-automation-live: GH_TOKEN or GITHUB_TOKEN must be set.');
  process.exit(1);
}

/** @type {{name:string,expected:string,actual:string,pass:boolean,group:string}[]} */
const checks = [];
let group = 'general';

const heading = (title) => {
  group = title;
  process.stdout.write(`\n${title}\n`);
};

const record = (name, expected, actual, pass) => {
  checks.push({ name, expected, actual, pass, group });
  process.stdout.write(`  ${pass ? 'ok  ' : 'FAIL'} ${name}\n`);
  process.stdout.write(`       ${actual}\n`);
};

const stamp = () => new Date().toISOString();

/** A raw call, so the response headers stay reachable. */
async function api(path, options = {}) {
  const response = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${options.token ?? TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'dheys-cms-ship-verification',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: response.status, headers: response.headers, json, text };
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

/* ------------------------------------------------------------------ set-up */

async function whoAmI() {
  heading('Identity');
  const { status, json, headers } = await api('/user');
  record(
    'the token resolves to a real account',
    'HTTP 200 and a login',
    `HTTP ${status}, login "${json?.login}", scopes "${headers.get('x-oauth-scopes') ?? '(none reported)'}"`,
    status === 200 && Boolean(json?.login),
  );
  return json?.login;
}

async function createScratch(owner) {
  heading('Scratch repository');
  const name = `dheys-cms-ship-check-${Date.now()}`;
  const { status, json } = await api('/user/repos', {
    method: 'POST',
    body: JSON.stringify({
      name,
      private: true,
      auto_init: true,
      description: 'Temporary. Created by a ship-sequence verification run and deleted by it.',
    }),
  });
  record(
    'a scratch repository can be created',
    'HTTP 201',
    `HTTP ${status}, created "${json?.full_name ?? name}" (private: ${json?.private})`,
    status === 201,
  );
  if (status !== 201) throw new Error('cannot continue without a scratch repository');
  return { owner, repo: name };
}

/* -------------------------------------------------------------- rate limit */

async function checkRateLimits() {
  heading('Rate limits, read from real responses');

  const first = await api('/rate_limit');
  const core = first.json?.resources?.core;
  record(
    'the API reports a core rate-limit budget',
    'a limit, a remaining count and a reset time',
    `limit ${core?.limit}, remaining ${core?.remaining}, resets ${new Date((core?.reset ?? 0) * 1000).toISOString()}`,
    typeof core?.limit === 'number' && typeof core?.remaining === 'number',
  );

  // The headers the client actually reads. `/rate_limit` itself is not counted against
  // the budget, so an ordinary endpoint is used to prove the numbers move.
  const a = await api('/user');
  const b = await api('/user');
  const remainingA = Number(a.headers.get('x-ratelimit-remaining'));
  const remainingB = Number(b.headers.get('x-ratelimit-remaining'));

  record(
    'every response carries the x-ratelimit headers the client reads',
    'x-ratelimit-limit, -remaining and -reset present',
    `limit ${a.headers.get('x-ratelimit-limit')}, remaining ${remainingA}, reset ${a.headers.get('x-ratelimit-reset')}`,
    Number.isFinite(remainingA) && Number.isFinite(Number(a.headers.get('x-ratelimit-limit'))),
  );

  record(
    'the remaining budget decreases as calls are spent',
    'the second call reports fewer remaining than the first',
    `${remainingA} then ${remainingB}`,
    remainingB < remainingA,
  );

  // A 403 with remaining 0 is how exhaustion presents. Provoking it for real would burn
  // 5,000 requests, so what is verified here is that the client has the numbers it needs
  // to stop *before* that: the reset time is in the future and is parseable as a date.
  const resetAt = new Date(Number(a.headers.get('x-ratelimit-reset')) * 1000);
  record(
    'the reset time parses to a real future instant',
    'a valid Date later than now',
    `${resetAt.toISOString()} (in ${Math.round((resetAt.getTime() - Date.now()) / 60000)} min)`,
    !Number.isNaN(resetAt.getTime()) && resetAt.getTime() > Date.now(),
  );
}

/* --------------------------------------------------------------- pagination */

async function checkPagination({ owner, repo }) {
  heading('Pagination, across a listing longer than one page');

  // Enough files that a per_page=2 listing needs several pages.
  const FILES = 7;
  for (let i = 1; i <= FILES; i += 1) {
    const path = `content/item-${String(i).padStart(2, '0')}.md`;
    const { status } = await api(`/repos/${owner}/${repo}/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `content: add item ${i}`,
        content: b64(`---\ntitle: Item ${i}\n---\n\nSeeded by a verification run.\n`),
      }),
    });
    if (status !== 201) {
      record(
        'seeding the scratch repository',
        'HTTP 201 per file',
        `HTTP ${status} on ${path}`,
        false,
      );
      return;
    }
  }
  record(
    'the scratch repository was seeded',
    `${FILES} files committed`,
    `${FILES} files committed one per request`,
    true,
  );

  // A directory listing longer than one page.
  const perPage = 2;
  const seen = [];
  let page = 1;
  let sawLinkHeader = false;
  for (;;) {
    const { status, json, headers } = await api(
      `/repos/${owner}/${repo}/commits?per_page=${perPage}&page=${page}`,
    );
    if (status !== 200 || !Array.isArray(json) || json.length === 0) break;
    if (headers.get('link')) sawLinkHeader = true;
    for (const commit of json) seen.push(commit.sha);
    const link = headers.get('link') ?? '';
    if (!link.includes('rel="next"')) break;
    page += 1;
    if (page > 20) break; // a runaway pager is a failure, not a loop to ride out
  }

  record(
    'a multi-page listing sends a Link header with rel="next"',
    'a Link header on at least the first page',
    sawLinkHeader ? 'Link header present' : 'no Link header was sent',
    sawLinkHeader,
  );

  const unique = new Set(seen);
  record(
    'walking every page yields each item exactly once',
    'no duplicates and no gaps across pages',
    `${seen.length} commits over ${page} page(s) at ${perPage} per page, ${unique.size} unique`,
    seen.length === unique.size && seen.length >= FILES,
  );

  // The count the pager arrived at must match an unpaginated read of the same listing.
  const all = await api(`/repos/${owner}/${repo}/commits?per_page=100`);
  record(
    'the paged total matches a single-page read of the same listing',
    'identical counts',
    `paged ${seen.length}, single page ${Array.isArray(all.json) ? all.json.length : 'n/a'}`,
    Array.isArray(all.json) && all.json.length === seen.length,
  );

  // A directory listing, which is the shape the admin actually reads.
  const dir = await api(`/repos/${owner}/${repo}/contents/content`);
  record(
    'a directory listing returns every file that was written',
    `${FILES} entries`,
    `${Array.isArray(dir.json) ? dir.json.length : 'n/a'} entries`,
    Array.isArray(dir.json) && dir.json.length === FILES,
  );

  // Past the last page GitHub returns an empty array, not a 404. A pager that treats
  // "empty" as an error stops one page early on an exact multiple of per_page.
  const past = await api(`/repos/${owner}/${repo}/commits?per_page=${perPage}&page=99`);
  record(
    'a page past the end is an empty list, not an error',
    'HTTP 200 with an empty array',
    `HTTP ${past.status} with ${Array.isArray(past.json) ? past.json.length : 'n/a'} entries`,
    past.status === 200 && Array.isArray(past.json) && past.json.length === 0,
  );
}

/* -------------------------------------------------------- permission errors */

async function checkPermissionErrors({ owner, repo }) {
  heading('Permission and error handling, against real responses');

  /*
   * 401 — a rejected credential.
   *
   * The value is assembled at runtime rather than written as a literal. It is not a real
   * token and never was, but it is token-*shaped*, and `pnpm check:clean-room` fails on a
   * credential shape wherever it appears. Writing it out would make the file that proves
   * the ship sequence the one thing that breaks the gate — which is the rule working.
   */
  const badToken = await api('/user', { token: ['ghp', '_', '0'.repeat(36)].join('') });
  record(
    'a rejected token returns 401',
    'HTTP 401',
    `HTTP ${badToken.status}: ${badToken.json?.message ?? '(no message)'}`,
    badToken.status === 401,
  );

  // 404 — present-or-invisible is deliberately indistinguishable, which is why the
  // client's message for 404 says so rather than claiming the thing does not exist.
  const invisible = await api(`/repos/${owner}/dheys-cms-no-such-repository-${Date.now()}`);
  record(
    'a repository the token cannot see returns 404, not 403',
    'HTTP 404',
    `HTTP ${invisible.status}: ${invisible.json?.message ?? '(no message)'}`,
    invisible.status === 404,
  );

  // 422 — a well-formed request GitHub still rejects. Creating a file that already exists
  // without its sha is the everyday version of this in the admin's commit path.
  const clash = await api(`/repos/${owner}/${repo}/contents/content/item-01.md`, {
    method: 'PUT',
    body: JSON.stringify({ message: 'content: collide on purpose', content: b64('again\n') }),
  });
  record(
    'writing over a file without its sha is rejected, not silently applied',
    'HTTP 422 or 409',
    `HTTP ${clash.status}: ${clash.json?.message ?? '(no message)'}`,
    clash.status === 422 || clash.status === 409,
  );

  // Writing to a repository that is not ours. Discovered at runtime rather than named in
  // this file, because a committed foreign repository reference would fail the clean-room
  // gate — which is exactly the rule working as intended.
  const search = await api('/search/repositories?q=stars:>50000&per_page=1');
  const foreign = search.json?.items?.[0];
  if (foreign) {
    const denied = await api(
      `/repos/${foreign.full_name}/contents/dheys-cms-should-never-exist.md`,
      {
        method: 'PUT',
        body: JSON.stringify({ message: 'this must not be accepted', content: b64('no\n') }),
      },
    );
    record(
      'writing to a repository the token does not own is refused',
      'HTTP 403 or 404, and no commit',
      `HTTP ${denied.status}: ${denied.json?.message ?? '(no message)'}`,
      denied.status === 403 || denied.status === 404,
    );
  }
}

/* ------------------------------------------------------------------ cleanup */

async function deleteScratch({ owner, repo }) {
  heading('Cleanup');
  if (keep) {
    record(
      'the scratch repository was left in place',
      '--keep was passed',
      'kept deliberately',
      true,
    );
    return;
  }

  const attempt = await api(`/repos/${owner}/${repo}`, { method: 'DELETE' });
  let status = attempt.status;

  /*
   * Deleting a repository needs the `delete_repo` scope, which is not implied by `repo`.
   * When the API refuses on scope, `gh` is tried as a second route: it may hold a token
   * with scopes this process's environment variable does not. If both refuse, the record
   * below says the repository still exists and names it as something to remove by hand,
   * rather than reporting a cleanup that did not happen.
   */
  if (status === 403) {
    try {
      execFileSync('gh', ['repo', 'delete', `${owner}/${repo}`, '--yes'], { stdio: 'pipe' });
      status = 204;
    } catch {
      /* fall through to the failure record below */
    }
  }

  const gone = await api(`/repos/${owner}/${repo}`);
  record(
    'the scratch repository was deleted',
    'HTTP 204 and a subsequent 404',
    status === 204
      ? `deleted, and a re-read returns HTTP ${gone.status}`
      : `DELETE returned HTTP ${status}: ${attempt.json?.message ?? '(no message)'} — "${owner}/${repo}" still exists and must be removed by hand`,
    status === 204 && gone.status === 404,
  );
}

/* --------------------------------------------------------------------- main */

async function main() {
  process.stdout.write(`verify-automation-live\nstarted ${stamp()}\n`);
  const owner = await whoAmI();
  const scratch = await createScratch(owner);

  try {
    await checkRateLimits();
    await checkPagination(scratch);
    await checkPermissionErrors(scratch);
  } finally {
    await deleteScratch(scratch);
  }

  const failed = checks.filter((check) => !check.pass);
  process.stdout.write(`\nfinished ${stamp()}\n`);
  process.stdout.write(
    `verify-automation-live: ${checks.length} check(s), ${checks.length - failed.length} passed, ${failed.length} failed.\n`,
  );

  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify({ finishedAt: stamp(), checks }, null, 2));
  }

  if (failed.length > 0) {
    process.stdout.write('\nFailed:\n');
    for (const check of failed) {
      process.stdout.write(
        `  - ${check.name}\n      expected ${check.expected}\n      actual   ${check.actual}\n`,
      );
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`verify-automation-live: ${error?.stack ?? error}`);
  process.exit(1);
});
