import { defineConfig } from '@playwright/test';

// Run against the isolated frontend instance on 127.0.0.1:3128. The spec mocks
// every API response and never starts or connects to a backend service.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'membership-application.spec.ts',
  workers: 1,
  timeout: 30000,
  expect: { timeout: 5000 },
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results/membership-application',
  use: { baseURL: 'http://127.0.0.1:3128', browserName: 'chromium', serviceWorkers: 'block', trace: 'retain-on-failure' },
});
