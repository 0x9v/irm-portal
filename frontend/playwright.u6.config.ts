import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: /(u6-feedback-states|module-document-search|u4-announcements|saved-documents|my-document-submissions|delegate-moderation|account-pages|signed-in-home)\.spec\.ts$/,
  workers: 1,
  reporter: 'list',
  outputDir: 'test-results/u6',
  use: { baseURL: process.env.IRM_U6_TEST_URL || 'http://127.0.0.1:3156', serviceWorkers: 'block' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
