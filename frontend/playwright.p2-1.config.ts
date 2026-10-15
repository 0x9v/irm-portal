import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["account-foundation.spec.ts"],
  timeout: 30000,
  expect: { timeout: 5000 },
  workers: 1,
  reporter: "list",
  outputDir: "test-results/p2-1",
  use: { baseURL: "http://127.0.0.1:3161", serviceWorkers: "block", ...devices["Desktop Chrome"] },
  webServer: { command: "npm run start -- --hostname 127.0.0.1 --port 3161", port: 3161, reuseExistingServer: false, timeout: 120000 },
});
