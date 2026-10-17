import { expect, test } from "@playwright/test";
import { buildTextPdf } from "../build-pdf";
import { login } from "./helpers";

/**
 * One pass through the PDF import: create the starter layout, read an invented
 * statement, see the preview, book it. Parsing detail is covered by unit tests;
 * this proves the parts meet through the UI.
 */

test.describe.configure({ mode: "serial" });

/**
 * Unique per run: the dedupe fingerprint includes the description, and CI
 * retries (retries: 2) share one database — a fixed text would be a duplicate
 * on the second attempt.
 */
const token = `PdfTest${Date.now()}`;
const description = `${token} Laden, Bern CH - Lebensmittel`;

const statement = buildTextPdf([
  [
    { x: 50, y: 720, text: "4435 92XX XXXX 1111 Cumulus Kreditkarte, Anna Muster" },
    { x: 50, y: 700, text: `26.09.26 28.09.26 ${token} Laden, Bern CH` },
    { x: 400, y: 700, text: "12.50" },
    { x: 50, y: 686, text: "Lebensmittel" },
    { x: 50, y: 660, text: "Total Karte Cumulus Kreditkarte 4435 92XX XXXX 1111" },
    { x: 400, y: 660, text: "12.50" },
  ],
]);

test("liest eine PDF-Abrechnung über das Standardlayout und bucht sie", async ({ page }) => {
  await login(page);
  await page.goto("/import");

  await page.getByRole("tab", { name: /Mappings/ }).click();
  // Absent when an earlier attempt or spec already created the starter layout.
  const seed = page.getByRole("button", { name: "Standardlayouts anlegen" }).first();
  if (await seed.isVisible()) await seed.click();
  await expect(page.getByText("Migros Kreditkarte (PDF)").first()).toBeVisible();

  await page.getByRole("tab", { name: "Neuer Import" }).click();
  await page.getByRole("button", { name: "PDF", exact: true }).click();
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "Privatkonto" }).click();

  await page.locator("#file").setInputFiles({
    name: "abrechnung.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(statement),
  });
  await page.getByRole("button", { name: "Datei einlesen" }).click();

  await expect(page.getByText(description).first()).toBeVisible();

  await page.getByRole("button", { name: "Alle neuen" }).click();
  await page.getByRole("button", { name: /1 Buchung\(en\) importieren/ }).click();
  await expect(page.getByText(/1 Buchung\(en\) importiert/).first()).toBeVisible();

  await page.goto(`/transactions?q=${encodeURIComponent(token)}`);
  await expect(page.getByText(description).first()).toBeVisible();
  await expect(page.getByText("−12.50").first()).toBeVisible();
});
