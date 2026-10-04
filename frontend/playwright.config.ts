import { defineConfig, devices } from '@playwright/test';
import path from 'path';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  expect: { timeout: 5000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'cd ../backend && POSTGRES_DB=irm_integration_test POSTGRES_USER=irm_test POSTGRES_PASSWORD=irm_test DATABASE_PORT=5432 DATABASE_HOST=127.0.0.1 STORAGE_ROOT=/tmp/irm_test_storage .venv/bin/uvicorn app.main:app --port 8000',
      port: 8000,
      reuseExistingServer: false,
      timeout: 10000,
    },
    {
      command: 'npm run start',
      port: 3000,
      reuseExistingServer: false,
      timeout: 10000,
    }
  ],
});
