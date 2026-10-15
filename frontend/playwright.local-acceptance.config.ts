import { defineConfig } from '@playwright/test';
import path from 'node:path';
const origin = process.env.IRM_ACCEPTANCE_FRONTEND;
const evidence = process.env.IRM_ACCEPTANCE_EVIDENCE;
if (!origin || new URL(origin).hostname !== '127.0.0.1' || !evidence || !process.env.IRM_ACCEPTANCE_MANIFEST) {
  throw new Error('Invoke the repository isolated acceptance runner.');
}
export default defineConfig({
  testDir: './e2e', testMatch: 'local-moderation-acceptance.spec.ts', workers: 1, retries: 0,
  timeout: 60000, expect: { timeout: 10000 },
  reporter: [['list'], ['./e2e/acceptance-reporter.ts', { outputFile: path.join(evidence, 'live-browser.json') }]],
  outputDir: path.join(evidence, 'live-browser'),
  use: { baseURL: origin, browserName: 'chromium', trace: 'off', video: 'off', screenshot: 'off' },
});
