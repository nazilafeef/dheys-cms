#!/usr/bin/env node
/**
 * Ship step 5 — verify the deployment, not a local preview.
 *
 * Every other gate in this repository measures a build on this machine. This one measures
 * what a reader actually receives from the live origin, which is the only thing that can
 * tell a correct build from a correct deployment: a base path that survives `astro preview`
 * and 404s on a project sub-path, a content type the host decides for itself, an asset that
 * exists in `dist/` and was never uploaded.
 *
 * Nothing here is mocked and nothing is inferred from the build output. Each check states
 * what it expected and what it received, and the run exits non-zero if any of them differ.
 *
 *   node scripts/verify-live.mjs --url https://example.invalid/path
 *   node scripts/verify-live.mjs --url <origin> --json out.json
 *   node scripts/verify-live.mjs --url <origin> --no-console   skip the browser pass
 */
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const readFlag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

const RAW = readFlag('--url');
if (!RAW) {
  console.error('verify-live: --url <origin> is required.');
  process.exit(1);
}
const BASE = RAW.replace(/\/+$/, '');
const JSON_OUT = readFlag('--json');
const ORIGIN = new URL(BASE).origin;
const BASE_PATH = new URL(BASE).pathname.replace(/\/+$/, '');

/** @typedef {{name:string,expected:string,actual:string,pass:boolean,group:string}} Check */
/** @type {Check[]} */
const checks = [];
let group = 'general';

const record = (name, expected, actual, pass) => {
  checks.push({ name, expected, actual, pass, group });
  process.stdout.write(`  ${pass ? 'ok  ' : 'FAIL'} ${name}\n`);
  if (!pass) {
    process.stdout.write(`       expected: ${expected}\n`);
    process.stdout.write(`       actual:   ${actual}\n`);
  }
};

const stamp = () => new Date().toISOString();

const heading = (title) => {
  group = title;
  process.stdout.write(`\n${title}\n`);
};

/**
 * GET with caching defeated, following redirects.
 *
 * Redirects are followed rather than reported, because on this host a redirect is the
 * normal case and not a fault: Astro emits directory-style pages, so `dist/admin/index.html`
 * is served at `/admin/` and GitHub Pages answers `/admin` with a 301 to it. Judging the
 * hop instead of the destination marks a correct canonicalisation as a broken link, which
 * an earlier run of this script did for 28 of 34 references. What matters is the status a
 * reader ends on, so that is what every check below is given.
 */
async function get(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'cache-control': 'no-cache', pragma: 'no-cache' },
  });
  const body = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body,
    redirected: response.redirected,
    finalUrl: response.url,
  };
}

/* ------------------------------------------------------------------ routes */

/*
 * The documents ship step 5 names, each with a string that proves the *right* document came
 * back. A bare 200 would also be returned by a host's parking page.
 */
const ROUTES = [
  { path: '/', name: 'site root', needle: '<html' },
  { path: '/admin', name: '/admin', needle: 'admin' },
  { path: '/sitemap.xml', name: 'sitemap.xml', needle: '<urlset' },
  { path: '/news-sitemap.xml', name: 'news-sitemap.xml', needle: '<urlset' },
  { path: '/rss.xml', name: 'rss.xml', needle: '<rss' },
  { path: '/atom.xml', name: 'atom.xml', needle: '<feed' },
  { path: '/feed.json', name: 'feed.json', needle: '"version"' },
  { path: '/robots.txt', name: 'robots.txt', needle: 'sitemap' },
  { path: '/llms.txt', name: 'llms.txt', needle: '#' },
];

async function checkRoutes() {
  heading('Documents');
  for (const route of ROUTES) {
    const url = `${BASE}${route.path}`;
    try {
      const { status, body } = await get(url);
      const matched = body.toLowerCase().includes(route.needle.toLowerCase());
      record(
        `${route.name} returns 200 with expected content`,
        `200 containing ${JSON.stringify(route.needle)}`,
        `${status}${matched ? ', content matched' : `, body did not contain ${JSON.stringify(route.needle)}`}`,
        status === 200 && matched,
      );
    } catch (error) {
      record(
        `${route.name} returns 200 with expected content`,
        '200',
        `request failed: ${error}`,
        false,
      );
    }
  }
}

/* --------------------------------------------------------------------- 404 */

async function check404() {
  heading('A missing path');
  const { status, body } = await get(`${BASE}/no-such-page-${Date.now()}`);
  record('a missing path returns a real 404 status', '404', String(status), status === 404);
  record(
    'the 404 body is this project’s own 404 document',
    'the project’s 404 markup',
    body.includes('<html') ? 'an HTML document was served' : 'not an HTML document',
    body.includes('<html') && /404/.test(body),
  );
  record(
    'the 404 page is noindex',
    'a robots meta containing noindex',
    /noindex/i.test(body) ? 'noindex present' : 'no noindex found',
    /noindex/i.test(body),
  );
}

/* ----------------------------------------------------------------- locales */

const LOCALES = [
  { code: 'en', path: '/', dir: 'ltr', lang: 'en' },
  { code: 'ar', path: '/ar/', dir: 'rtl', lang: 'ar' },
  { code: 'dv', path: '/dv/', dir: 'rtl', lang: 'dv' },
];

async function checkLocales() {
  heading('Locale routes');
  for (const locale of LOCALES) {
    const { status, body } = await get(`${BASE}${locale.path}`);
    const lang = /<html[^>]*\blang="([^"]+)"/i.exec(body);
    const dir = /<html[^>]*\bdir="([^"]+)"/i.exec(body);
    record(`${locale.code} route responds 200`, '200', String(status), status === 200);
    record(
      `${locale.code} declares lang="${locale.lang}"`,
      `lang="${locale.lang}"`,
      lang ? `lang="${lang[1]}"` : 'no lang attribute',
      lang?.[1] === locale.lang,
    );
    record(
      `${locale.code} declares dir="${locale.dir}"`,
      `dir="${locale.dir}"`,
      dir ? `dir="${dir[1]}"` : 'no dir attribute',
      dir?.[1] === locale.dir,
    );
  }

  // Thaana rendering is the point of shipping Dhivehi at all.
  const { body } = await get(`${BASE}/dv/`);
  const thaana = /[ހ-޿]/.test(body);
  record(
    'the Dhivehi route renders Thaana script',
    'at least one character in U+0780–U+07BF',
    thaana ? 'Thaana present' : 'no Thaana characters found',
    thaana,
  );

  // Latin punctuation in Thaana is a defect the brief calls out by name.
  const thaanaRuns = body.match(/[ހ-޿][ހ-޿\s,;?]*[ހ-޿]/g) ?? [];
  const latinInThaana = thaanaRuns.filter((run) => /[,;?]/.test(run));
  record(
    'Dhivehi content uses Thaana punctuation, not Latin',
    'no Latin comma, semicolon or question mark inside a Thaana run',
    latinInThaana.length === 0
      ? `${thaanaRuns.length} Thaana run(s), none with Latin punctuation`
      : `${latinInThaana.length} run(s) contained Latin punctuation`,
    latinInThaana.length === 0,
  );
}

/* ----------------------------------------------------------------- headers */

async function checkHeaders() {
  heading('Response headers');
  const root = await get(`${BASE}/`);

  const contentType = root.headers.get('content-type') ?? '(none)';
  record(
    'the document is served as HTML with a UTF-8 charset',
    'text/html with charset=utf-8',
    contentType,
    /text\/html/i.test(contentType) && /utf-8/i.test(contentType),
  );

  record(
    'the origin is HTTPS and serves the site root',
    '200 over https',
    `${root.status} over ${new URL(BASE).protocol.replace(':', '')}${root.redirected ? ` (canonicalised to ${root.finalUrl})` : ''}`,
    root.status === 200 && new URL(BASE).protocol === 'https:',
  );

  const server = root.headers.get('server') ?? '(none)';
  record('the host identifies itself', 'a server header', server, server !== '(none)');

  const xml = await get(`${BASE}/rss.xml`);
  const xmlType = xml.headers.get('content-type') ?? '(none)';
  record(
    'rss.xml is served as XML rather than HTML or plain text',
    'an xml content-type',
    xmlType,
    /xml/i.test(xmlType),
  );

  const txt = await get(`${BASE}/robots.txt`);
  const txtType = txt.headers.get('content-type') ?? '(none)';
  record('robots.txt is served as plain text', 'text/plain', txtType, /text\/plain/i.test(txtType));

  const json = await get(`${BASE}/feed.json`);
  const jsonType = json.headers.get('content-type') ?? '(none)';
  record('feed.json is served as JSON', 'a json content-type', jsonType, /json/i.test(jsonType));
}

/* ------------------------------------------------------- assets and links */

/** Every same-origin href/src on a page, resolved to an absolute URL. */
function extractRefs(html, pageUrl) {
  const refs = new Set();
  const pattern = /(?:href|src)="([^"]+)"/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const raw = match[1];
    if (!raw || raw.startsWith('#') || raw.startsWith('data:') || raw.startsWith('mailto:')) {
      continue;
    }
    let resolved;
    try {
      resolved = new URL(raw, pageUrl);
    } catch {
      continue;
    }
    if (resolved.origin !== ORIGIN) continue; // external targets are listed, never requested
    refs.add(resolved.href.split('#')[0]);
  }
  return [...refs];
}

async function checkAssetsAndLinks() {
  heading('Assets and internal links');

  const seeds = ['/', '/ar/', '/dv/', '/archive', '/admin', '/search'];
  const found = new Map();

  for (const seed of seeds) {
    const pageUrl = `${BASE}${seed}`;
    const { status, body } = await get(pageUrl);
    if (status !== 200) continue;
    for (const ref of extractRefs(body, pageUrl)) {
      if (!found.has(ref)) found.set(ref, seed);
    }
  }

  let missingBase = 0;
  for (const ref of found.keys()) {
    const path = new URL(ref).pathname;
    if (BASE_PATH && path !== BASE_PATH && !path.startsWith(`${BASE_PATH}/`)) missingBase += 1;
  }
  record(
    'every internal reference carries the deployment base path',
    `all under ${BASE_PATH || '/'}`,
    missingBase === 0
      ? `all ${found.size} under ${BASE_PATH || '/'}`
      : `${missingBase} of ${found.size} missing the base path`,
    missingBase === 0,
  );

  const broken = [];
  let canonicalised = 0;
  for (const [ref, from] of found) {
    let status;
    try {
      const response = await fetch(ref, { redirect: 'follow' });
      status = response.status;
      if (response.redirected) canonicalised += 1;
      await response.arrayBuffer();
    } catch (error) {
      status = `request failed: ${error}`;
    }
    if (status !== 200) broken.push(`${ref} -> ${status} (linked from ${from})`);
  }

  record(
    'every internal reference resolves on the live origin',
    `${found.size} references returning 200`,
    broken.length === 0
      ? `${found.size} references, all 200 (${canonicalised} via a 301 to the trailing-slash form)`
      : `${broken.length} did not: ${broken.slice(0, 5).join('; ')}`,
    broken.length === 0,
  );

  return { checked: found.size, canonicalised, broken };
}

/* ---------------------------------------------------------------- console */

/**
 * Zero console errors on every page, measured in a real browser against the live origin.
 *
 * Playwright is imported dynamically so the rest of this script stays dependency-free and
 * usable anywhere `fetch` exists. Page errors (uncaught exceptions) count as errors too --
 * a page can throw without ever writing to the console.
 *
 * Failed *requests* are reported as errors as well, because that is how a missing asset
 * under a project sub-path actually manifests in a browser.
 */
async function checkConsole() {
  heading('Console, in a real browser');

  let chromium;
  try {
    ({ chromium } = await import('@playwright/test'));
  } catch {
    record(
      'a browser is available to measure console output',
      'playwright installed',
      'not installed',
      false,
    );
    return;
  }

  const pages = ['/', '/ar/', '/dv/', '/archive', '/admin', '/search'];
  const browser = await chromium.launch();
  try {
    for (const path of pages) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const problems = [];

      page.on('console', (message) => {
        if (message.type() === 'error' || message.type() === 'warning') {
          problems.push(`${message.type()}: ${message.text()}`);
        }
      });
      page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
      page.on('requestfailed', (request) => {
        problems.push(
          `requestfailed: ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`,
        );
      });

      const response = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      await context.close();

      record(
        `${path} loads with no console errors or warnings`,
        'no error or warning output, and no failed request',
        problems.length === 0
          ? `clean (HTTP ${response?.status() ?? '?'})`
          : `${problems.length}: ${problems.slice(0, 3).join(' | ')}`,
        problems.length === 0,
      );
    }
  } finally {
    await browser.close();
  }
}

/* -------------------------------------------------------------------- main */

async function main() {
  process.stdout.write(`verify-live: ${BASE}\nstarted ${stamp()}\n`);

  await checkRoutes();
  await check404();
  await checkLocales();
  await checkHeaders();
  const links = await checkAssetsAndLinks();
  if (!args.includes('--no-console')) await checkConsole();

  const failed = checks.filter((check) => !check.pass);
  process.stdout.write(`\nfinished ${stamp()}\n`);
  process.stdout.write(
    `verify-live: ${checks.length} check(s), ${checks.length - failed.length} passed, ${failed.length} failed.\n`,
  );

  if (JSON_OUT) {
    writeFileSync(
      JSON_OUT,
      JSON.stringify({ base: BASE, finishedAt: stamp(), checks, links }, null, 2),
    );
  }

  if (failed.length > 0) {
    process.stdout.write('\nFailed:\n');
    for (const check of failed) {
      process.stdout.write(`  - ${check.name}\n`);
      process.stdout.write(`      expected ${check.expected}\n`);
      process.stdout.write(`      actual   ${check.actual}\n`);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`verify-live: ${error?.stack ?? error}`);
  process.exit(1);
});
