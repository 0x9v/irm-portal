import { defineConfig, devices } from '@playwright/test';

if (!process.env.IRM_RELEASE_SPEC_DIR || !process.env.IRM_RELEASE_URL || !process.env.IRM_RELEASE_OUTPUT) {
  throw new Error('Use npm run release:acceptance to prepare the isolated mocked suite.');
}

export default defineConfig({
  testDir: process.env.IRM_RELEASE_SPEC_DIR,
  testMatch: '*.spec.ts',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: `${process.env.IRM_RELEASE_OUTPUT}/playwright-report` }],
  ],
  outputDir: `${process.env.IRM_RELEASE_OUTPUT}/artifacts`,
  use: { baseURL: process.env.IRM_RELEASE_URL, serviceWorkers: 'block', trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
});
