import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'navigation-shell.spec.ts',
  timeout: 30000,
  expect: { timeout: 6000 },
  workers: 1,
  reporter: 'list',
  outputDir: 'test-results/navigation-shell',
  use: { baseURL: 'http://127.0.0.1:3112', serviceWorkers: 'block', ...devices['Desktop Chrome'] },
  webServer: { command: 'npm run start -- --hostname 127.0.0.1 --port 3112', port: 3112, reuseExistingServer: false, timeout: 120000 },
});
