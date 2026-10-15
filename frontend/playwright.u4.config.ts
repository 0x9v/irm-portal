import { defineConfig, devices } from '@playwright/test';

// Start the existing frontend separately. API requests are mocked by the suite.
export default defineConfig({
  testDir: './e2e',
  testMatch: /u4-announcements\.spec\.ts$/,
  workers: 1,
  reporter: 'list',
  use: { baseURL: process.env.IRM_U4_TEST_URL || 'http://127.0.0.1:3000' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
