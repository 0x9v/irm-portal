import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["password-security.spec.ts"],
  timeout: 30000,
  expect: { timeout: 5000 },
  workers: 1,
  reporter: "list",
  outputDir: "test-results/p3-2",
  use: { baseURL: "http://127.0.0.1:3163", serviceWorkers: "block", ...devices["Desktop Chrome"] },
  webServer: { command: "npm run start -- --hostname 127.0.0.1 --port 3163", port: 3163, reuseExistingServer: false, timeout: 120000 },
});
