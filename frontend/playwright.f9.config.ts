import { defineConfig } from '@playwright/test';

// Frontend-only mocked Support and dashboard checks. No backend/startup hooks.
export default defineConfig({
  testDir: './e2e', testMatch: ['support.spec.ts', 'signed-in-home.spec.ts'],
  workers: 1, timeout: 30000, expect: { timeout: 6000 }, retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/f9/results.json' }]],
  outputDir: 'test-results/f9/captures',
  use: { baseURL: process.env.IRM_F9_TEST_URL || 'http://127.0.0.1:3149', browserName: 'chromium',
    viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', trace: 'retain-on-failure' },
});
