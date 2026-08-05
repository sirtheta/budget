import { defineConfig } from "@playwright/test";
import { existsSync } from "fs";
import path from "path";

/**
 * Runs `tests/e2e-prod/` against a real production server (`next start`), for
 * the failure modes the dev server cannot show — client router behaviour after
 * a Server Action differs between the two. Requires a build first:
 *
 *   npm run build && npm run test:e2e:prod
 *
 * Its own port and database, so it can run next to the dev-server suite.
 */
const PORT = 3112;
const dbPath = path.join(__dirname, "tests/e2e/.data/e2e.db");

const systemChromium = "/opt/pw-browsers/chromium";
const launchOptions = existsSync(systemChromium) ? { executablePath: systemChromium } : undefined;

export default defineConfig({
  testDir: "./tests/e2e-prod",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    launchOptions,
  },
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATABASE_URL: `file:${dbPath}`,
      // http, so NextAuth and proxy.ts stay on the non-secure cookie name.
      AUTH_URL: `http://localhost:${PORT}`,
      AUTH_SECRET: "e2e-only-secret-not-used-anywhere-else-0000",
      DISABLE_EMAIL: "true",
      DISABLE_BACKUP: "true",
      DISABLE_RECURRING: "true",
    },
  },
});
