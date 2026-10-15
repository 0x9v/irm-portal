import { defineConfig } from '@playwright/test';

// Start an isolated frontend on 3128 separately. Every API/WebSocket is mocked.
// No backend/database hooks, webServer configuration or existing-server reuse.
export default defineConfig({
  testDir: './e2e', testMatch: 'mobile-home.spec.ts', workers: 1,
  timeout: 30000, expect: { timeout: 10000 },
  reporter: [['list'], ['json', { outputFile: 'test-results/home-mobile-20261010/results.json' }]],
  outputDir: 'test-results/home-mobile-20261010/tests',
  use: { baseURL: 'http://127.0.0.1:3128', browserName: 'chromium', serviceWorkers: 'block', trace: 'retain-on-failure' },
});
