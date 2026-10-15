import { defineConfig, devices } from '@playwright/test';

// Production copy only; no server/backend hooks or existing-server reuse.
// Build/start the copy with NEXT_PUBLIC_API_URL=http://127.0.0.1:18999.
export default defineConfig({
  testDir: './e2e',
  testMatch: ['home-composition.spec.ts', 'home-navigation-acceptance.spec.ts',
    'foundation-acceptance.spec.ts', 'manual-testing-reader.spec.ts', 'manual-testing-logout.spec.ts'],
  grep: /Home composition|Home navigation acceptance|Foundation acceptance Header|Manual Testing Corrections/,
  timeout: 30000,
  expect: { timeout: 5000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list'], ['json', { outputFile: 'test-results/home-navigation-acceptance-20261008/results.json' }]],
  outputDir: 'test-results/home-navigation-acceptance-20261008/production',
  use: { baseURL: 'http://127.0.0.1:3103', serviceWorkers: 'block', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
