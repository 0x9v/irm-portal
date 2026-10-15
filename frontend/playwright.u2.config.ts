import { defineConfig } from '@playwright/test';

// Mocked browser checks only; start a completed frontend build separately.
export default defineConfig({
  testDir: './e2e',
  testMatch: ['u2-mobile-header-theme.spec.ts', 'navigation-shell.spec.ts', 'theme-preference.spec.ts', 'theme-account-surfaces.spec.ts'],
  workers: 1, retries: 0, timeout: 60000, expect: { timeout: 6000 },
  reporter: [['list'], ['json', { outputFile: 'test-results/u2/results.json' }]],
  outputDir: 'test-results/u2/captures',
  use: { baseURL: process.env.IRM_U2_TEST_URL || 'http://127.0.0.1:3152', browserName: 'chromium',
    viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', trace: 'retain-on-failure' },
});
