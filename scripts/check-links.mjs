#!/usr/bin/env node
/**
 * Internal link checker.
 *
 * Walks the built output and resolves every internal link, script, stylesheet and image
 * against the files actually on disk. It exists for one specific failure: a GitHub Pages
 * project site is served from `/dheys-cms/`, and a single root-relative URL that forgot
 * the base path looks perfect in `astro dev` and 404s on the live site. That bug is
 * invisible to a build and to a typecheck, so it needs its own gate.
 *
 * Checks, in both hosting modes:
 *   - every internal href/src resolves to a file in dist
 *   - every in-page `#fragment` matches an id that exists in that document
 *   - no URL in the output is missing the deployment base
 *   - external links are listed but never requested (a link checker that hits the network
 *     is a flaky test and a rate-limit waiting to happen)
 *
 *   pnpm check:links
 *   pnpm check:links --verbose
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const verbose = process.argv.includes('--verbose');

const BASE_PATH = normaliseBase(process.env.BASE_PATH ?? '/dheys-cms');

/** @param {string} raw */
function normaliseBase(raw) {
  const segments = String(raw).split('/').filter(Boolean);
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

if (!existsSync(DIST)) {
  console.error('check:links: no dist/ directory. Run `pnpm build` first.');
  process.exit(1);
}

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) found.push(...walk(abs));
    else found.push(abs);
  }
  return found;
}

const allFiles = walk(DIST);
const htmlFiles = allFiles.filter((file) => extname(file) === '.html');

/** Every path the deployment can serve, as a site-absolute URL including the base. */
const served = new Set();
for (const file of allFiles) {
  const rel = relative(DIST, file).split(sep).join('/');
  const withBase = BASE_PATH === '/' ? `/${rel}` : `${BASE_PATH}/${rel}`;
  served.add(withBase);
  // `/x/index.html` is also served as `/x/` and `/x`. The root `index.html` has no
  // leading directory, so it needs the `rel === 'index.html'` arm too -- without it the
  // checker reports the site's own home page as unserved.
  if (rel === 'index.html' || rel.endsWith('/index.html')) {
    const dir = withBase.slice(0, -'index.html'.length);
    served.add(dir);
    served.add(dir.replace(/\/$/, '') || '/');
  }
}

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/** @type {{file: string, url: string, reason: string}[]} */
const problems = [];
/** @type {Set<string>} */
const externals = new Set();
let checked = 0;

for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8');
  const pageRel = relative(DIST, file).split(sep).join('/');

  const ids = new Set();
  for (const match of html.matchAll(/\sid="([^"]+)"/g)) {
    if (match[1]) ids.add(match[1]);
  }

  /** @type {string[]} */
  const references = [];
  for (const match of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
    if (match[1]) references.push(match[1]);
  }

  for (const raw of references) {
    const url = raw.trim();
    if (
      url === '' ||
      url.startsWith('mailto:') ||
      url.startsWith('tel:') ||
      url.startsWith('data:')
    ) {
      continue;
    }

    if (EXTERNAL.test(url)) {
      externals.add(url.split('?')[0] ?? url);
      continue;
    }

    checked += 1;

    if (url.startsWith('#')) {
      const fragment = decodeURIComponent(url.slice(1));
      if (fragment !== '' && !ids.has(fragment)) {
        problems.push({
          file: pageRel,
          url,
          reason: `no element with id="${fragment}" in this document`,
        });
      }
      continue;
    }

    const [pathPart = ''] = url.split('#');
    const [cleanPath = ''] = pathPart.split('?');
    if (cleanPath === '') continue;

    if (!cleanPath.startsWith('/')) {
      problems.push({
        file: pageRel,
        url,
        reason: 'relative URL — every emitted URL should be site-absolute and carry the base',
      });
      continue;
    }

    if (BASE_PATH !== '/' && !cleanPath.startsWith(`${BASE_PATH}/`) && cleanPath !== BASE_PATH) {
      problems.push({
        file: pageRel,
        url,
        reason: `root-relative URL missing the deployment base "${BASE_PATH}" — this is the bug that only shows up on the live site`,
      });
      continue;
    }

    const decoded = decodeURIComponent(cleanPath);
    if (
      !served.has(decoded) &&
      !served.has(`${decoded}/`) &&
      !served.has(`${decoded}/index.html`)
    ) {
      problems.push({ file: pageRel, url, reason: 'no file in dist/ serves this path' });
    }
  }
}

if (verbose && externals.size > 0) {
  console.log(`check:links: ${externals.size} external target(s), not requested:`);
  for (const url of [...externals].sort()) console.log(`  ${url}`);
  console.log('');
}

if (problems.length > 0) {
  console.error(`check:links: ${problems.length} broken reference(s).\n`);
  for (const problem of problems) {
    console.error(`  ${problem.file}`);
    console.error(`    ${problem.url}`);
    console.error(`      ${problem.reason}\n`);
  }
  process.exit(1);
}

console.log(
  `check:links: OK — ${checked} internal reference(s) across ${htmlFiles.length} page(s) resolve, base "${BASE_PATH}". ${externals.size} external target(s) left unrequested.`,
);
