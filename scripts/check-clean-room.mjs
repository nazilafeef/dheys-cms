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
    const gitArgs = stagedOnly
      ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR']
      : ['ls-files'];
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

/** @returns {import('./clean-room.mjs').Violation[]} */
function scanCommitHistory() {
  try {
    const out = execFileSync('git', ['log', '--pretty=format:%H%x1f%B%x1e', '--all'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    const violations = [];
    for (const record of out.split('\x1e')) {
      const [sha, body] = record.split('\x1f');
      if (!sha || !body) continue;
      violations.push(
        ...scanText(body, `commit ${sha.trim().slice(0, 10)}`).map((v) => ({ ...v, line: 0 })),
      );
    }
    return violations;
  } catch {
    return [];
  }
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

  if (scanHistory && !stagedOnly) {
    violations.push(...scanCommitHistory());
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

  console.log(
    `clean-room: OK -- ${scanned} file(s) scanned${scanHistory && !stagedOnly ? ' plus commit history' : ''}, no violations.`,
  );
}

main();
