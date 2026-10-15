import { defineConfig, devices } from '@playwright/test';

const frontendUrl = process.env.ETUDSUP_PR4_FRONTEND_URL;
if (!frontendUrl || !/^https?:$/.test(new URL(frontendUrl).protocol)) {
  throw new Error('Set ETUDSUP_PR4_FRONTEND_URL to an already running frontend URL.');
}

export default defineConfig({
  testDir: './e2e',
  testMatch: ['community-posts.spec.ts', 'announcement-replies.spec.ts'],
  grep: /(\b17\. Reply composer|\b18\. A reply request|\b19\. Private reply media|\b20\. Reply removal|\b21\. A direct active-account|\b22\. Private image authorization|\b23\. Empty, oversized|\b24\. Invalid private routes|\b6\. All ACTIVE roles|\b11\. Confirmed 201)/,
  timeout: 30000,
  expect: { timeout: 7000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: frontendUrl,
    ...devices['Desktop Chrome'],
    serviceWorkers: 'block',
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
});
