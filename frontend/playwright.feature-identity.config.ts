import { defineConfig } from '@playwright/test';

// Frontend-only server. Every API/WebSocket call in these specs is mocked.
export default defineConfig({
  testDir: './e2e',
  testMatch: ['feature-page-identity.spec.ts', 'guest-home.spec.ts'],
  workers: 1,
  timeout: 45000,
  expect: { timeout: 8000 },
  reporter: 'list',
  outputDir: 'test-results/feature-identity',
  use: {
    baseURL: 'http://127.0.0.1:3142', browserName: 'chromium',
    serviceWorkers: 'block', trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3142',
    port: 3142, reuseExistingServer: false, timeout: 60000,
  },
});
