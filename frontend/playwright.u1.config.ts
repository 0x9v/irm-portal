import { defineConfig } from '@playwright/test';

// Frontend-only, existing deny-by-default fixtures. No owner service/backend hooks.
export default defineConfig({
  testDir: './e2e',
  testMatch: ['actions-underlines.spec.ts', 'signed-in-home.spec.ts', 'navigation-shell.spec.ts', 'theme-preference.spec.ts', 'theme-account-surfaces.spec.ts', 'support.spec.ts', 'member-directory.spec.ts'],
  workers: 1, retries: 0, timeout: 120000, expect: { timeout: 6000 },
  reporter: [['list'], ['json', { outputFile: 'test-results/u1/results.json' }]],
  outputDir: 'test-results/u1/captures',
  use: { baseURL: process.env.IRM_U1_TEST_URL || 'http://127.0.0.1:3151', browserName: 'chromium', viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', trace: 'retain-on-failure' },
});
