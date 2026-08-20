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
    command: `pnpm exec astro preview --port ${PORT} --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}${prefix}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
