import { defineConfig } from '@playwright/test';

// An independently built frontend on 3128; no backend, server or database hooks.
export default defineConfig({
  testDir: './e2e', testMatch: 'delegate-moderation.spec.ts', workers: 1,
  timeout: 30000, expect: { timeout: 5000 }, retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/delegate-moderation/results.json' }]],
  outputDir: 'test-results/delegate-moderation/browser',
  use: { baseURL: 'http://127.0.0.1:3128', browserName: 'chromium', serviceWorkers: 'block', trace: 'retain-on-failure' },
});
