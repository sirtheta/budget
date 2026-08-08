/**
 * Captures the screenshots embedded in public/benutzerhandbuch.html.
 *
 * Use a production build, not `next dev` — dev mode shows the Turbopack
 * activity badge, which isn't in the existing screenshots and would
 * visibly mismatch.
 *
 * Usage:
 *   1. Seed a demo instance:
 *        DATABASE_URL=file:./data/demo-manual.db npx prisma db push
 *        DATABASE_URL=file:./data/demo-manual.db ENCRYPTION_KEY=<any 32+ chars> \
 *          npx tsx scripts/seed-manual-demo.ts
 *   2. Build + start against it:
 *        DATABASE_URL=file:./data/demo-manual.db npx next build
 *        DATABASE_URL=file:./data/demo-manual.db ENCRYPTION_KEY=<same as above> \
 *          DISABLE_EMAIL=true DISABLE_BACKUP=true DISABLE_RECURRING=true \
 *          AUTH_SECRET=<any 32+ char string> AUTH_URL=http://localhost:3222 \
 *          npx next start -p 3222
 *      (DISABLE_RECURRING matters here: without it, the hourly cron could
 *      post the deliberately-due "Fitnessabo" suggestion out from under the
 *      dashboard/recurring screenshots mid-capture.)
 *   3. Capture:  MANUAL_BASE_URL=http://localhost:3222 npx tsx scripts/manual-screenshots.ts [names...]
 *      (omit names to capture everything; pass e.g. "dashboard budget"
 *      to only regenerate specific shots — see the `shots` list below for names)
 *   4. Splice the PNGs in scripts/.manual-shots/ back into the manual (as base64
 *      data URIs) with scripts/splice-manual-screenshots.ts.
 *
 * Demo accounts: admin@demo.local / editor@demo.local / viewer@demo.local,
 * password Demo1234! (see scripts/seed-manual-demo.ts for the full roster).
 */
import { chromium, type Page } from "playwright";
import { existsSync, mkdirSync } from "fs";
import path from "path";

const BASE_URL = process.env.MANUAL_BASE_URL ?? "http://localhost:3222";
const OUT_DIR = path.join(__dirname, ".manual-shots");
const FIXTURE_CSV = path.join(__dirname, "fixtures", "manual-import-demo.csv");
const ADMIN = { email: "admin@demo.local", password: "Demo1234!" };

// Same fallback as playwright.config.ts: some sandboxed environments ship a
// system-wide Chromium and block the per-version download.
const systemChromium = "/opt/pw-browsers/chromium";
const launchOptions = existsSync(systemChromium) ? { executablePath: systemChromium } : undefined;

async function login(page: Page, creds: { email: string; password: string }) {
  await page.goto(`${BASE_URL}/login`);
  await page.fill("#email", creds.email);
  await page.fill("#password", creds.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/);
}

/**
 * Recharts animates its bars, lines and slices in on mount. Screenshotting the
 * moment the page settles catches half-grown bars and a pie without its ring,
 * so chart pages wait for the SVG and then for the animation to finish.
 */
async function settleCharts(page: Page) {
  await page.waitForSelector(".recharts-surface");
  await page.waitForTimeout(1500);
}

type Shot = { name: string; run: (page: Page) => Promise<void> };

const shots: Shot[] = [
  {
    name: "login",
    run: async (page) => {
      await page.goto(`${BASE_URL}/login`);
      await page.waitForSelector("#email");
      await page.screenshot({ path: path.join(OUT_DIR, "login.png") });
    },
  },
  {
    name: "dashboard",
    run: async (page) => {
      await login(page, ADMIN);
      await page.goto(`${BASE_URL}/dashboard`);
      await page.waitForSelector("text=Dashboard");
      await settleCharts(page);
      await page.screenshot({ path: path.join(OUT_DIR, "dashboard.png"), fullPage: true });
    },
  },
  {
    name: "two-factor-setup",
    run: async (page) => {
      await login(page, ADMIN);
      await page.goto(`${BASE_URL}/dashboard`);
      await page.click('button[aria-label="Benutzermenü"]');
      await page.click("text=Zwei-Faktor-Authentifizierung");
      await page.waitForSelector('img[alt="QR-Code für die Authenticator-App"]');
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(OUT_DIR, "two-factor-setup.png") });
    },
  },
  {
    name: "transactions",
    run: async (page) => {
      await login(page, ADMIN);
      await page.goto(`${BASE_URL}/transactions`);
      await page.waitForSelector("text=Buchungen");
      await page.screenshot({ path: path.join(OUT_DIR, "transactions.png"), fullPage: true });
    },
  },
  {
    name: "transaction-form",
    run: async (page) => {
      await login(page, ADMIN);
      await page.goto(`${BASE_URL}/transactions`);
      await page.getByRole("button", { name: "Neue Buchung" }).click();
      await page.waitForSelector("text=Betrag (CHF)");
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(OUT_DIR, "transaction-form.png") });
    },
  },
  {
    name: "budget",
    run: async (page) => {
      await login(page, ADMIN);
      await page.goto(`${BASE_URL}/budget`);
      await page.waitForSelector("text=Budget");
      await page.screenshot({ path: path.join(OUT_DIR, "budget.png"), fullPage: true });
    },
  },
  {
    name: "reserves",
    run: async (page) => {
      await login(page, ADMIN);
      await page.goto(`${BASE_URL}/reserves`);
      await page.waitForSelector("text=Rückstellungen & Sparziele");
      await page.screenshot({ path: path.join(OUT_DIR, "reserves.png"), fullPage: true });
    },
  },
  {
    name: "analytics",
    run: async (page) => {
      await login(page, ADMIN);
      await page.goto(`${BASE_URL}/analytics`);
      await page.waitForSelector("text=Auswertungen");
      await settleCharts(page);
      await page.screenshot({ path: path.join(OUT_DIR, "analytics.png"), fullPage: true });
    },
  },
  {
    name: "accounts",
    run: async (page) => {
      await login(page, ADMIN);
      await page.goto(`${BASE_URL}/accounts`);
      await page.waitForSelector("text=Konten");
      await page.screenshot({ path: path.join(OUT_DIR, "accounts.png"), fullPage: true });
    },
  },
  {
    name: "categories",
    run: async (page) => {
      await login(page, ADMIN);
      await page.goto(`${BASE_URL}/categories`);
      await page.waitForSelector("text=Kategorien");
      await page.screenshot({ path: path.join(OUT_DIR, "categories.png"), fullPage: true });
    },
  },
  {
    name: "recurring",
    run: async (page) => {
      await login(page, ADMIN);
      await page.goto(`${BASE_URL}/recurring`);
      await page.waitForSelector("text=Wiederkehrende Buchungen");
      await page.screenshot({ path: path.join(OUT_DIR, "recurring.png"), fullPage: true });
    },
  },
  {
    name: "import-preview",
    run: async (page) => {
      await login(page, ADMIN);
      await page.goto(`${BASE_URL}/import`);
      await page.waitForSelector("text=Datei hochladen");

      const form = page.locator("form").first();
      await form.getByRole("button", { name: "CSV", exact: true }).click();
      await page.setInputFiles("#file", FIXTURE_CSV);

      await page.click("#import-account");
      await page.fill('input[placeholder="Konto suchen…"]', "Kreditkarte");
      await page.getByRole("option", { name: "Kreditkarte", exact: true }).click();

      await form.getByRole("button", { name: "Datei einlesen" }).click();
      await page.waitForSelector("text=Vorschau —");
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT_DIR, "import-preview.png"), fullPage: true });
    },
  },
  {
    name: "users",
    run: async (page) => {
      await login(page, ADMIN);
      await page.goto(`${BASE_URL}/users`);
      await page.waitForSelector("text=Benutzer");
      await page.screenshot({ path: path.join(OUT_DIR, "users.png"), fullPage: true });
    },
  },
  {
    name: "settings",
    run: async (page) => {
      await login(page, ADMIN);
      await page.goto(`${BASE_URL}/settings`);
      await page.waitForSelector("text=E-Mail (SMTP)");
      await page.screenshot({ path: path.join(OUT_DIR, "settings.png"), fullPage: true });
    },
  },
  {
    name: "audit",
    run: async (page) => {
      await login(page, ADMIN);
      await page.goto(`${BASE_URL}/audit`);
      await page.waitForSelector("text=Audit-Log");
      await page.screenshot({ path: path.join(OUT_DIR, "audit.png"), fullPage: true });
    },
  },
];

async function main() {
  const requested = process.argv.slice(2);
  const selected = requested.length ? shots.filter((s) => requested.includes(s.name)) : shots;
  if (selected.length === 0) {
    console.error("No matching shots. Known names:", shots.map((s) => s.name).join(", "));
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch(launchOptions);

  for (const shot of selected) {
    // Fresh context per shot so each login starts logged out — /login
    // redirects away immediately for an already-authenticated session.
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    try {
      await shot.run(page);
      console.log("captured:", shot.name);
    } catch (err) {
      console.error("failed:", shot.name, err);
    } finally {
      await page.close();
      await context.close();
    }
  }

  await browser.close();
}

main();
