import { defineConfig, devices } from '@playwright/test';

// Isolated frontend only. All /api/v1 calls are intercepted by mocked fixtures.
export default defineConfig({
  testDir: './e2e',
  testMatch: ['guest-home.spec.ts', 'signed-in-home.spec.ts'],
  timeout: 30000,
  expect: { timeout: 5000 },
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  outputDir: 'test-results/signed-home',
  use: {
    baseURL: 'http://127.0.0.1:3110',
    serviceWorkers: 'block',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'npm run start -- --hostname 127.0.0.1 --port 3110',
    port: 3110,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
