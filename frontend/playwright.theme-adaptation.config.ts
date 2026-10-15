import { defineConfig } from '@playwright/test';
import themeConfig from './playwright.theme.config';

// Inherits the mock-only isolated frontend contract. No startup/reset hooks.
export default defineConfig({
  ...themeConfig,
  testMatch: 'theme-account-surfaces.spec.ts',
  outputDir: './test-results/theme-account-surfaces',
});
