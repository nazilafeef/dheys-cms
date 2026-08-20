#!/usr/bin/env node
/**
 * Clean-room gate (CLI).
 *
 * Runs the rule engine in scripts/clean-room.mjs over every file git would ship, plus
 * the full commit-message history. Exits non-zero on the first violation so CI stops
 * the build. See docs/DECISIONS.md for why this is a gate rather than a convention.
 *
 *   pnpm check:clean-room            scan tracked files + commit messages
 *   pnpm check:clean-room --staged   scan only what is staged (pre-commit use)
 *   pnpm check:clean-room --no-history
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanText, formatViolations, isBinaryPath } from './clean-room.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = new Set(process.argv.slice(2));
const scanHistory = !args.has('--no-history');
const stagedOnly = args.has('--staged');

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.astro',
  'coverage',
  'test-results',
  'playwright-report',
  '_pagefind',
  '.tmp',
]);

/** @returns {string[]} repo-relative paths */
function listFiles() {
  try {
    // `--others --exclude-standard` matters: plain `ls-files` lists only *tracked* files,
    // so a newly written file is invisible to the gate until after it has been committed.
    // That is precisely backwards -- the check exists to stop a leak reaching a commit.
    // Found when three XML namespace hosts in a new src/lib/feeds.ts sailed past a green
    // run and were only reported once the file was staged.
    const gitArgs = stagedOnly
      ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR']
      : ['ls-files', '--cached', '--others', '--exclude-standard'];
    const out = execFileSync('git', gitArgs, { cwd: ROOT, encoding: 'utf8' });
    const files = out
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (files.length > 0) return files;
  } catch {
    // Not a git repo yet, or git unavailable -- fall through to a filesystem walk.
  }
  return walk(ROOT).map((abs) => relative(ROOT, abs).split(sep).join('/'));
}

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const abs = join(dir, entry);
    const stats = statSync(abs);
    if (stats.isDirectory()) found.push(...walk(abs));
    else found.push(abs);
  }
  return found;
}

/**
 * @typedef {object} HistoryScan
 * @property {boolean} available whether a commit history was actually read
 * @property {number} commits how many commit messages were scanned
 * @property {import('./clean-room.mjs').Violation[]} violations
 */

/**
 * Scan every commit message on every ref.
 *
 * The `available` flag exists so the summary line cannot claim work that did not happen.
 * An unpacked release archive carries no `.git`, and an empty result there means "nothing
 * was read", not "nothing was found". Reporting those two as the same thing is how a gate
 * comes to certify something it never looked at.
 *
 * @returns {HistoryScan}
 */
function scanCommitHistory() {
  let out;
  try {
    out = execFileSync('git', ['log', '--pretty=format:%H%x1f%B%x1e', '--all'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return { available: false, commits: 0, violations: [] };
  }

  /** @type {import('./clean-room.mjs').Violation[]} */
  const violations = [];
  let commits = 0;
  for (const record of out.split('\x1e')) {
    const [sha, body] = record.split('\x1f');
    if (!sha || !body) continue;
    commits += 1;
    violations.push(
      ...scanText(body, `commit ${sha.trim().slice(0, 10)}`).map((v) => ({ ...v, line: 0 })),
    );
  }
  return { available: true, commits, violations };
}

function main() {
  const files = listFiles();
  /** @type {import('./clean-room.mjs').Violation[]} */
  const violations = [];
  let scanned = 0;

  for (const file of files) {
    if (isBinaryPath(file)) continue;
    const abs = join(ROOT, file);
    if (!existsSync(abs)) continue;
    let text;
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\u0000')) continue; // binary without a telling extension
    scanned += 1;
    violations.push(...scanText(text, file));
  }

  /** @type {HistoryScan} */
  let history = { available: false, commits: 0, violations: [] };
  if (scanHistory && !stagedOnly) {
    history = scanCommitHistory();
    violations.push(...history.violations);
  }

  if (violations.length > 0) {
    console.error(formatViolations(violations));
    console.error(
      'Clean-room gate FAILED. Committed files may not name a foreign domain, another\n' +
        'GitHub repository, or anything shaped like a credential. Fix the source -- do not\n' +
        'widen ALLOWED_DOMAINS in scripts/clean-room.mjs unless the host genuinely belongs.',
    );
    process.exit(1);
  }

  // Say what was actually examined. Printing "plus commit history" unconditionally would
  // be a claim rather than a report: an unpacked release archive has no history to read.
  let historyNote = '';
  if (scanHistory && !stagedOnly) {
    historyNote = history.available
      ? ` plus ${history.commits} commit message(s)`
      : ' (no commit history here -- not a git checkout)';
  }

  console.log(`clean-room: OK -- ${scanned} file(s) scanned${historyNote}, no violations.`);
}

main();
