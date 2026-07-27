import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test.describe("Buchungen erfassen", () => {
  test("erfasst eine Ausgabe und zeigt sie in der Liste", async ({ page }) => {
    await login(page);

    await page.goto("/transactions");
    await page.getByRole("button", { name: "Neue Buchung" }).click();

    await page.getByLabel("Betrag (CHF)").fill("82.40");
    await page.getByLabel("Beschreibung").fill("Wocheneinkauf E2E");
    await page.getByRole("button", { name: "Speichern" }).click();

    await expect(page.getByRole("dialog")).toBeHidden();
    // .first(): the row also renders in the mobile card list, hidden by CSS
    // at this viewport rather than absent from the DOM.
    await expect(page.getByText("Wocheneinkauf E2E").first()).toBeVisible();
    // Expenses are stored negative and rendered with a typographic minus.
    await expect(page.getByText("−82.40").first()).toBeVisible();
  });

  test("filtert die Liste nach Suchbegriff", async ({ page }) => {
    await login(page);
    await page.goto("/transactions");

    // Role-scoped: the submit button's aria-label ("Suchen") also matches "Suche".
    await page.getByRole("textbox", { name: "Suche" }).fill("Wocheneinkauf");
    await page.getByRole("button", { name: "Suchen" }).click();

    await expect(page.getByText("Wocheneinkauf E2E").first()).toBeVisible();
  });
});

test.describe("Navigation", () => {
  test("erreicht alle Hauptseiten ohne Fehler", async ({ page }) => {
    await login(page);

    for (const [path, heading] of [
      ["/budget", "Budget"],
      ["/reserves", "Rückstellungen & Sparziele"],
      ["/analytics", "Auswertungen"],
      ["/accounts", "Konten"],
      ["/categories", "Kategorien"],
      ["/recurring", "Wiederkehrende Buchungen"],
      ["/import", "Import"],
      ["/users", "Benutzer"],
      ["/settings", "Einstellungen"],
      ["/audit", "Audit-Log"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    }
  });
});

test.describe("Budget", () => {
  test("setzt einen Budgetbetrag und rechnet ihn gegen die Ist-Ausgaben", async ({ page }) => {
    await login(page);
    await page.goto("/budget");

    const input = page.getByLabel("Budgetbetrag").first();
    await input.fill("600");
    await input.blur();

    await expect(page.getByText("600.00").first()).toBeVisible();
  });
});
