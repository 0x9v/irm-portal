import { defineConfig, devices } from '@playwright/test';

// The owner supplies an already-running frontend. The selected specs use the
// context-level API/WebSocket deny fixture before their explicit mocks.
const baseURL = process.env.IRM_D2_FRONTEND_URL;
if (!baseURL || !/^https?:$/.test(new URL(baseURL).protocol)) {
  throw new Error('Set IRM_D2_FRONTEND_URL to an existing HTTP(S) frontend URL.');
}
export default defineConfig({
  testDir: './e2e',
  testMatch: /\/(?:discussion|discussion-redesign|discussion-stickers|delegate-moderation)\.spec\.ts$/,
  timeout: 30000,
  expect: { timeout: 5000 },
  workers: 1,
  reporter: 'list',
  use: { baseURL, serviceWorkers: 'block', trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
