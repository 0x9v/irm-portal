import { defineConfig, devices } from '@playwright/test';

// Isolated browser run: this config starts only the frontend development server.
export default defineConfig({
  testDir: './e2e',
  testMatch: ['guest-home.spec.ts'],
  timeout: 30000,
  expect: { timeout: 5000 },
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  outputDir: 'test-results/guest-home',
  use: {
    baseURL: 'http://127.0.0.1:3108',
    serviceWorkers: 'block',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3108',
    port: 3108,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
