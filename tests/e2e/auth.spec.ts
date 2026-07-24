import { expect, test } from "@playwright/test";
import { E2E_VIEWER } from "./global-setup";
import { login } from "./helpers";

test.describe("Anmeldung", () => {
  test("leitet nicht angemeldete Besucher auf den Login um", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForURL("**/login**");
    await expect(page.getByRole("button", { name: "Anmelden" })).toBeVisible();
  });

  test("weist falsche Zugangsdaten ab, ohne zu verraten warum", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-Mail").fill("admin@e2e.local");
    await page.getByLabel("Passwort", { exact: true }).fill("falsch");
    await page.getByRole("button", { name: "Anmelden" }).click();
    await expect(page.getByText(/ungültig|falsch/i)).toBeVisible();
    await expect(page).toHaveURL(/login/);
  });

  test("meldet einen Admin an und wieder ab", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: "Benutzermenü" }).click();
    await page.getByRole("menuitem", { name: "Abmelden" }).click();
    await page.waitForURL("**/login**");
  });
});

test.describe("Berechtigungen", () => {
  test("hält einen Betrachter von der Benutzerverwaltung fern", async ({ page }) => {
    await login(page, E2E_VIEWER);
    await page.goto("/users");
    // requireAdmin redirects rather than showing a 403.
    await page.waitForURL("**/dashboard**");
  });

  test("blendet Admin-Navigation für einen Betrachter aus", async ({ page }) => {
    await login(page, E2E_VIEWER);
    await expect(page.getByRole("link", { name: "Benutzer" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Buchungen" })).toBeVisible();
  });
});
