import { defineConfig } from '@playwright/test';

// Isolated frontend only. All API requests are intercepted by the spec.
// No backend, database, webServer hooks, or existing-service reuse.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'home-visual-reference.spec.ts',
  timeout: 30000,
  expect: { timeout: 10000 },
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/home-visual-20261010/results.json' }]],
  outputDir: 'test-results/home-visual-20261010/tests',
  use: { baseURL: 'http://127.0.0.1:3127', browserName: 'chromium', serviceWorkers: 'block', trace: 'retain-on-failure' },
});
