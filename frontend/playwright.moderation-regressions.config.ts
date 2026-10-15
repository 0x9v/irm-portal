import { defineConfig } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';

// Invoke through node tests/run-moderation-regressions.mjs. It copies existing
// mocked specs and adds a deny-network fixture without editing their originals.
const directory = process.env.IRM_MODERATION_REGRESSION_DIR;
if (!directory?.startsWith(path.join(os.tmpdir(), 'irm-moderation-regressions-'))) {
  throw new Error('Run node tests/run-moderation-regressions.mjs to create guarded isolated specs.');
}
export default defineConfig({
  testDir: directory, testMatch: '*.spec.ts', workers: 1,
  timeout: 30000, expect: { timeout: 5000 }, retries: 0,
  reporter: [['list'], ['./e2e/acceptance-reporter.ts', { outputFile: path.join(process.env.IRM_ACCEPTANCE_EVIDENCE || 'test-results/delegate-moderation', 'regressions.json') }]],
  outputDir: path.join(process.env.IRM_ACCEPTANCE_EVIDENCE || 'test-results/delegate-moderation', 'regressions'),
  use: { baseURL: process.env.IRM_ACCEPTANCE_FRONTEND || 'http://127.0.0.1:3128', browserName: 'chromium', serviceWorkers: 'block', trace: process.env.IRM_ACCEPTANCE_FRONTEND ? 'off' : 'retain-on-failure' },
});
