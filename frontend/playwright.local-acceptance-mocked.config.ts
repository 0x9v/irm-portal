import { defineConfig } from '@playwright/test';
import path from 'node:path';
const origin = process.env.IRM_ACCEPTANCE_FRONTEND;
const evidence = process.env.IRM_ACCEPTANCE_EVIDENCE;
if (!origin || new URL(origin).hostname !== '127.0.0.1' || !evidence) throw new Error('Invoke the isolated acceptance runner.');
export default defineConfig({
  testDir: './e2e', testMatch: ['member-directory.spec.ts', 'delegate-moderation.spec.ts'], workers: 1,
  timeout: 30000, expect: { timeout: 5000 }, retries: 0,
  reporter: [['list'], ['./e2e/acceptance-reporter.ts', { outputFile: path.join(evidence, 'mocked-browser.json') }]],
  outputDir: path.join(evidence, 'mocked-browser'),
  use: { baseURL: origin, browserName: 'chromium', serviceWorkers: 'block', trace: 'off', video: 'off', screenshot: 'off' },
});
