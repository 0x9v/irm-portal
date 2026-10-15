import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: /(u5-document-rows|module-document-search|document-metadata-navigation|saved-documents|recent-documents|my-document-submissions|document-reader)\.spec\.ts$/,
  workers: 1,
  reporter: 'list',
  outputDir: 'test-results/u5',
  use: { baseURL: process.env.IRM_U5_TEST_URL || 'http://127.0.0.1:3155', serviceWorkers: 'block' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
