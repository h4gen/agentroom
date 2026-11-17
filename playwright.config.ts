import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: process.env.AGENTROOM_TEST_URL ? 90_000 : 45_000,
  expect: { timeout: process.env.AGENTROOM_TEST_URL ? 15_000 : 5_000 },
  use: {
    baseURL: process.env.AGENTROOM_TEST_URL || "http://127.0.0.1:8787",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: process.env.AGENTROOM_TEST_URL
    ? undefined
    : {
        command: "pnpm exec wrangler dev --port 8787",
        url: "http://127.0.0.1:8787",
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
  reporter: [["list"]],
});
