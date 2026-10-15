import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'saved-documents.spec.ts',
  workers: 1,
  timeout: 30000,
  expect: { timeout: 5000 },
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results/saved-documents',
  use: { baseURL: 'http://127.0.0.1:3131', browserName: 'chromium', serviceWorkers: 'block', trace: 'retain-on-failure' },
});
