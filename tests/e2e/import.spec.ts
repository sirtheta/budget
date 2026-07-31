import path from "path";
import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

/**
 * End-to-end cover for the import wizard.
 *
 * The wizard is the app's highest-risk surface: it is the one flow where a bug
 * writes money into the database without anyone typing it, and its client
 * state (file, preview, per-row selection, per-row category override, commit)
 * is the most involved in the codebase. lib/import/* is thoroughly unit
 * tested, but nothing exercised the preview → commit → undo path through the
 * UI, which is where the parts meet.
 *
 * The tests run in order against one shared database (workers: 1), so the
 * import performed by the first is what the duplicate and undo tests act on.
 * The fixture's descriptions all begin with "Auszug", a token no other spec
 * writes — the counts below share a database with everything else in the run.
 */

const FIXTURE = path.join(__dirname, "fixtures", "camt053-e2e.xml");

test.describe.configure({ mode: "serial" });

/**
 * Number of bookings matching a search term, read from the transaction list's
 * own header. Counting rendered rows would count each booking twice — the
 * desktop table and the mobile card list are both in the DOM, with one hidden
 * by CSS rather than absent.
 */
async function bookingCount(page: Page, query: string): Promise<number> {
  await page.goto(`/transactions?q=${encodeURIComponent(query)}`);
  const header = await page.getByText(/Buchung\(en\) · Saldo der Auswahl/).innerText();
  return Number(header.match(/^(\d+) Buchung/)?.[1]);
}

/** Reads the fixture into the preview table, targeting the seeded account. */
async function readFixture(page: Page): Promise<void> {
  await page.goto("/import");

  // The seeded E2E account carries no IBAN, so "Automatisch (über IBAN)" has
  // nothing to match on — pick the account explicitly.
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "Privatkonto" }).click();

  await page.locator("#file").setInputFiles(FIXTURE);
  await page.getByRole("button", { name: "Datei einlesen" }).click();

  await expect(page.getByText("Auszug Wocheneinkauf Coop").first()).toBeVisible();
}

test.describe("Import", () => {
  test("liest einen CAMT.053-Auszug ein und zeigt eine Vorschau", async ({ page }) => {
    await login(page);
    await readFixture(page);

    // All three entries parsed, in both directions.
    await expect(page.getByText("Auszug Lohnzahlung Januar").first()).toBeVisible();
    await expect(page.getByText("Auszug Krankenkasse Praemie").first()).toBeVisible();

    // Nothing is written before the user confirms — the preview is the point.
    expect(await bookingCount(page, "Auszug")).toBe(0);
  });

  test("übernimmt die ausgewählten Buchungen", async ({ page }) => {
    await login(page);
    await readFixture(page);

    await page.getByRole("button", { name: "Alle neuen" }).click();
    await page.getByRole("button", { name: /3 Buchung\(en\) importieren/ }).click();

    // .first(): the result is announced both on the success card and in a toast.
    await expect(page.getByText(/3 Buchung\(en\) importiert/).first()).toBeVisible();

    await page.goto("/transactions");
    await expect(page.getByText("Auszug Wocheneinkauf Coop").first()).toBeVisible();
    await expect(page.getByText("Auszug Lohnzahlung Januar").first()).toBeVisible();
    // Debit stored negative, credit positive — the sign convention survives
    // the parser, the preview and the commit. Expenses carry a typographic
    // minus; income in the list is rendered without a forced plus.
    await expect(page.getByText("−124.55").first()).toBeVisible();
    await expect(page.getByText("6'800.00").first()).toBeVisible();
  });

  test("erkennt denselben Auszug beim zweiten Einlesen als Duplikat", async ({ page }) => {
    await login(page);
    await readFixture(page);

    // The whole promise of the dedupe fingerprint: re-reading a statement is
    // safe. Duplicates start unchecked, so "Alle neuen" finds nothing to add
    // and the commit button stays disabled.
    await expect(page.getByText("Bereits importiert").first()).toBeVisible();
    await page.getByRole("button", { name: "Alle neuen" }).click();
    await expect(page.getByText("0 ausgewählt")).toBeVisible();
    await expect(page.getByRole("button", { name: /Buchung\(en\) importieren/ })).toBeDisabled();

    // Still three, not six.
    expect(await bookingCount(page, "Auszug")).toBe(3);
  });

  test("macht einen Import als Ganzes rückgängig", async ({ page }) => {
    await login(page);
    await page.goto("/import");

    // The batch history lives on its own tab now, not on the page directly.
    await page.getByRole("tab", { name: "Verlauf" }).click();
    await page.getByRole("button", { name: "Import rückgängig machen" }).first().click();
    await page.getByRole("button", { name: "Rückgängig machen" }).click();

    await expect(page.getByText(/3 Buchung\(en\) entfernt/)).toBeVisible();

    // The batch goes as a whole — that is what makes trying an import safe.
    expect(await bookingCount(page, "Auszug")).toBe(0);
  });
});
