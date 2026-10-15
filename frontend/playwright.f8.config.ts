import { defineConfig } from '@playwright/test';

// Frontend-only mocked checks. Start the completed build separately; no backend hooks.
export default defineConfig({
  testDir: './e2e',
  testMatch: ['navigation-shell.spec.ts', 'theme-preference.spec.ts',
    'theme-account-surfaces.spec.ts', 'signed-in-home.spec.ts'],
  workers: 1, timeout: 30000, expect: { timeout: 6000 }, retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/f8/results.json' }]],
  outputDir: 'test-results/f8/captures',
  use: { baseURL: process.env.IRM_F8_TEST_URL || 'http://127.0.0.1:3148', browserName: 'chromium',
    viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', trace: 'retain-on-failure' },
});
