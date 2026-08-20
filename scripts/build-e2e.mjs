#!/usr/bin/env node
/**
 * The build the end-to-end suite runs against.
 *
 * Identical to `pnpm build`, plus two environment values the tests need:
 *
 *   PUBLIC_SITE_REGISTRY — so the admin has sites to manage. It is the *example* registry,
 *                          whose sites are all invented. A real deployment loads its
 *                          registry from a gist, a companion repository or a secret; this
 *                          is a fixture, and it lives here rather than in the app so no
 *                          test hook ships inside the product.
 *   PUBLIC_THEME         — `dheys`, so the branded theme is exercised rather than only the
 *                          neutral default.
 *
 * This is a separate step rather than part of the Playwright `webServer` command, because
 * building there races the test run: `astro build` empties `dist/` before it refills it,
 * and Playwright starts polling as soon as the preview answers. The first attempt at that
 * produced 26 failures against a half-written directory.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const registry = readFileSync(new URL('../src/sites.example.json', import.meta.url), 'utf8');

const result = spawnSync('pnpm', ['exec', 'astro', 'build'], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    PUBLIC_SITE_REGISTRY: JSON.stringify(JSON.parse(registry)),
    PUBLIC_THEME: 'dheys',
  },
});

if (result.status !== 0) {
  console.error('build:e2e failed.');
  process.exit(result.status ?? 1);
}

console.log('build:e2e: built with the example registry and the Dheys theme.');
