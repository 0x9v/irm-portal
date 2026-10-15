import { defineConfig } from '@playwright/test';

// Owned frontend only; every API/WebSocket request is mocked in the suite.
export default defineConfig({
  testDir: './e2e', testMatch: 'member-directory.spec.ts', workers: 1,
  timeout: 30000, expect: { timeout: 5000 }, retries: 0,
  reporter: 'list', outputDir: 'test-results/member-directory',
  use: { baseURL: 'http://127.0.0.1:3128', browserName: 'chromium', serviceWorkers: 'block', trace: 'retain-on-failure' },
});
