import { defineConfig, devices } from '@playwright/test';

const frontendUrl = process.env.ETUDSUP_D4_FRONTEND_URL;
if (!frontendUrl || !/^https?:$/.test(new URL(frontendUrl).protocol)) {
  throw new Error('Set ETUDSUP_D4_FRONTEND_URL to an already running frontend URL.');
}

export default defineConfig({
  testDir: './e2e',
  testMatch: [
    'module-resources.spec.ts', 'module-resource-submission.spec.ts',
    'module-resource-review.spec.ts', 'my-document-submissions.spec.ts',
  ],
  workers: 1, retries: 0, reporter: 'list', timeout: 30000, expect: { timeout: 7000 },
  use: { baseURL: frontendUrl, ...devices['Desktop Chrome'], serviceWorkers: 'block', trace: 'retain-on-failure' },
});
