import { defineConfig } from '@playwright/test';

// The app is started separately on loopback; all API calls are intercepted by
// the focused spec so no backend or database is involved.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'module-document-search.spec.ts',
  workers: 1,
  timeout: 30000,
  expect: { timeout: 5000 },
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results/module-document-search',
  use: { baseURL: 'http://127.0.0.1:3129', browserName: 'chromium', serviceWorkers: 'block', trace: 'retain-on-failure' },
});
