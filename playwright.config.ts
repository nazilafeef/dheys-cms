import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against a real production build served by `astro preview`.
 * Every outbound call the app can make -- api.github.com and any AI provider --
 * is intercepted per-test. No test in this suite may reach a real service;
 * see tests/e2e/_mocks.ts.
 */
const PORT = Number(process.env.E2E_PORT ?? 4321);
const BASE_PATH = process.env.BASE_PATH ?? '/dheys-cms';
const prefix = BASE_PATH === '/' ? '' : BASE_PATH;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}${prefix}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    /*
     * Preview only. The build is a separate step (`pnpm build:e2e`, run by the
     * `pretest:e2e` hook) rather than part of this command.
     *
     * Building here races the run: `astro build` empties `dist/` before it refills it, and
     * Playwright starts as soon as the preview answers. Doing it that way produced 26
     * failures against a half-written directory, all of them looking like application bugs.
     */
    command: `pnpm exec astro preview --port ${PORT} --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}${prefix}/`,
    // Never reuse a server locally either: a preview left over from another run serves a
    // different build, and the failures that produces are extremely misleading.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
