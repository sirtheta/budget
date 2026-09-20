import { expect, test } from "@playwright/test";
import { login } from "./helpers";

/**
 * Covers the wallet-stakes flow end to end: create a wallet, assign two
 * Crypto accounts to it, verify the share % split, and record a joint
 * top-up via "Anteile erfassen".
 *
 * The Crypto account-type option label ("Bitcoin-Wallet") comes from
 * ACCOUNT_TYPE_LABELS in lib/balances.ts, not from the account-name field
 * (labelled "Bezeichnung", not "Name" — only the wallet-name field is
 * labelled "Name").
 */
test.describe("Bitcoin-Wallet mit Anteilen", () => {
  test("legt Wallet und Anteile an und erfasst einen Zugang", async ({ page }) => {
    await login(page);
    await page.goto("/accounts");

    await page.getByRole("button", { name: "Neue Wallet" }).click();
    await page.getByLabel("Name").fill("E2E Wallet");
    await page.getByRole("button", { name: "Speichern" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();

    for (const [name, btc] of [
      ["E2E Anteil Eltern", "0.2"],
      ["E2E Anteil Kind", "0.1"],
    ] as const) {
      await page.getByRole("button", { name: "Neues Konto" }).click();
      await page.getByLabel("Bezeichnung").fill(name);
      await page.getByLabel("Kontoart").click();
      await page.getByRole("option", { name: "Bitcoin-Wallet" }).click();
      await page.getByLabel("BTC-Bestand").fill(btc);
      await page.getByLabel("Gehört zu Wallet (optional)").click();
      await page.getByRole("option", { name: "E2E Wallet" }).click();
      await page.getByRole("button", { name: "Speichern" }).click();
      await expect(page.getByRole("dialog")).toBeHidden();
    }

    // 0.2 of 0.3 BTC — the split this card exists to make readable.
    await expect(page.getByText("66.7 %").first()).toBeVisible();

    await page.getByRole("button", { name: "Anteile erfassen" }).click();
    await page.getByLabel("+ BTC").first().fill("0.05");
    await page.getByRole("button", { name: "Speichern" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();

    await expect(page.getByText("0.25000000 BTC").first()).toBeVisible();
  });
});
