import { defineConfig } from '@playwright/test';

// All API data is mocked by the focused browser spec; no backend or database is used.
export default defineConfig({
  testDir: './e2e',
  testMatch: ['document-metadata-navigation.spec.ts', 'document-reader.spec.ts'],
  workers: 1,
  timeout: 30000,
  expect: { timeout: 5000 },
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results/document-metadata-navigation',
  use: { baseURL: 'http://127.0.0.1:3131', browserName: 'chromium', serviceWorkers: 'block', trace: 'retain-on-failure' },
});
