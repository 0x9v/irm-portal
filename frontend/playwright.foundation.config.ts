import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

// Start a separately built frontend on this port. No backend or webServer hooks:
// never run this suite through the application's reuseExistingServer config.
// Build that isolated copy with NEXT_PUBLIC_API_URL=http://127.0.0.1:18999.
export default defineConfig({
  testDir: './e2e',
  testMatch: [
    'header.spec.ts', 'page-layouts.spec.ts', 'support.spec.ts',
    'acceptance-navigation-a11y.spec.ts', 'manual-testing-reader.spec.ts',
    'manual-testing-logout.spec.ts', 'visual-foundation.spec.ts',
    'foundation-acceptance.spec.ts', 'home-composition.spec.ts', 'announcements.spec.ts',
  ],
  timeout: 30000,
  expect: { timeout: 5000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  outputDir: path.resolve(__dirname, 'test-results/home-composition-20261008/production'),
  use: {
    baseURL: 'http://127.0.0.1:3102',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
