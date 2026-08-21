#!/usr/bin/env node
/**
 * The build the end-to-end suite runs against.
 *
 * Identical to `pnpm build`, plus one environment value the tests need:
 *
 *   PUBLIC_THEME — `dheys`, so the branded theme is exercised rather than only the neutral
 *                  default.
 *
 * **No registry is injected.** It used to be: the example registry was inlined at build
 * time so the admin had sites to manage. That made the zero-registry state unreachable, so
 * nothing tested it — and the admin shipped with every view gated on a registry it could
 * never load in a browser. Tests that want sites now ask for them the way an operator does,
 * through `useExampleRegistry` in `_mocks.ts`.
 *
 * This is a separate step rather than part of the Playwright `webServer` command, because
 * building there races the test run: `astro build` empties `dist/` before it refills it,
 * and Playwright starts polling as soon as the preview answers. The first attempt at that
 * produced 26 failures against a half-written directory.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const result = spawnSync('pnpm', ['exec', 'astro', 'build'], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    PUBLIC_THEME: 'dheys',
  },
});

if (result.status !== 0) {
  console.error('build:e2e failed.');
  process.exit(result.status ?? 1);
}

console.log('build:e2e: built with the Dheys theme and no injected registry.');
