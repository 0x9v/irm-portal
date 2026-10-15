import { defineConfig, devices } from '@playwright/test';

// Only use with a separately copied frontend built with the mock-only API URL
// http://127.0.0.1:18999 and started on a free test port. No backend/reset/server hooks.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'theme-preference.spec.ts',
  timeout: 30000,
  expect: { timeout: 5000 },
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  outputDir: './test-results/theme-preference',
  use: {
    baseURL: process.env.IRM_THEME_TEST_URL || 'http://127.0.0.1:3114',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
