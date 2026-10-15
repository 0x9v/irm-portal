import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["profile-editing.spec.ts"],
  timeout: 30000,
  expect: { timeout: 5000 },
  workers: 1,
  reporter: "list",
  outputDir: "test-results/p2-2",
  use: { baseURL: "http://127.0.0.1:3162", serviceWorkers: "block", ...devices["Desktop Chrome"] },
  webServer: { command: "npm run start -- --hostname 127.0.0.1 --port 3162", port: 3162, reuseExistingServer: false, timeout: 120000 },
});
