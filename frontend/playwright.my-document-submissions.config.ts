import { defineConfig } from '@playwright/test';

// Dedicated frontend target; the focused suite mocks all API responses.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'my-document-submissions.spec.ts',
  workers: 1,
  timeout: 30000,
  expect: { timeout: 5000 },
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results/my-document-submissions',
  use: { baseURL: 'http://127.0.0.1:3130', browserName: 'chromium', serviceWorkers: 'block', trace: 'retain-on-failure' },
});
