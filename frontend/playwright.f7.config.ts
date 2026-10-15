import { defineConfig } from '@playwright/test';

// No backend/database/server hooks. The runner copies existing specs behind
// the existing deny-by-default API fixture before executing them.
export default defineConfig({
  testDir: process.env.IRM_F7_REGRESSION_DIR || './e2e',
  testMatch: ['f7-feature-theme-mobile.spec.ts', 'theme-preference.spec.ts', 'theme-account-surfaces.spec.ts',
    'navigation-shell.spec.ts', 'signed-in-home.spec.ts', 'announcements.spec.ts', 'announcement-replies.spec.ts',
    'module-document-search.spec.ts', 'document-metadata-navigation.spec.ts', 'document-reader.spec.ts'],
  workers: 1, timeout: 30000, expect: { timeout: 5000 }, retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/f7/results.json' }]],
  outputDir: 'test-results/f7/captures',
  use: { baseURL: process.env.IRM_F7_TEST_URL || 'http://127.0.0.1:3147', browserName: 'chromium',
    viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', trace: 'retain-on-failure' },
});
