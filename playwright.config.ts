import { defineConfig, devices } from "@playwright/test";

const port = 3100;
const outagePort = 3104;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  // Several browsers share one local server, so allow more than the 5 second default.
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    // Only on a retry, so one bad run can't write hundreds of megabytes of traces.
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Tests the production build, because CSP and caching behave differently in dev.
  webServer: [
    {
      command: `npm run start -- -p ${port}`,
      url: `http://localhost:${port}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    // The same build with no reachable database, for testing how outages look.
    {
      command: `npm run start -- -p ${outagePort}`,
      url: `http://localhost:${outagePort}/login`,
      env: { DATABASE_URL: "postgres://localhost:5999/unreachable" },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
