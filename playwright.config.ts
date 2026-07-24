import { defineConfig } from "@playwright/test";
import { existsSync } from "fs";
import path from "path";

const PORT = 3111;
const dbPath = path.join(__dirname, "tests/e2e/.data/e2e.db");

// Some sandboxed environments ship a system-wide Chromium (and block the
// per-version download). Use it when present; otherwise Playwright's own
// managed browser (CI: `npx playwright install chromium`) is used.
const systemChromium = "/opt/pw-browsers/chromium";
const launchOptions = existsSync(systemChromium) ? { executablePath: systemChromium } : undefined;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 60_000,
  retries: process.env.CI ? 2 : 0,
  // Single worker: all tests share one SQLite database and one dev server.
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    launchOptions,
  },
  webServer: {
    // The dev server (not `next start`) so no production build is required
    // and the session cookie name matches the proxy's non-production branch.
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      DATABASE_URL: `file:${dbPath}`,
      AUTH_SECRET: "e2e-only-secret-not-used-anywhere-else-0000",
      AUTH_URL: `http://localhost:${PORT}`,
      DISABLE_EMAIL: "true",
      DISABLE_BACKUP: "true",
      DISABLE_RECURRING: "true",
    },
  },
});
