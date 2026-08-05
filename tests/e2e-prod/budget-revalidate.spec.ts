import { expect, test } from "@playwright/test";
import { login } from "../e2e/helpers";

/**
 * Guards a bug class that only ever appeared in a production build: the client
 * router applied a server action's revalidated data one dispatch late, so every
 * Soll input showed the *previous* save until the next one came in. The dev
 * server dispatches router actions through a different code path and never
 * reproduced it — hence this separate, production-build suite.
 *
 * Amounts differ per iteration: they persist in the database, so a repeated
 * constant would pass on the previous iteration's content.
 */
test("jede Soll-Eingabe schlägt sofort auf Zeile und Total durch", async ({ page }) => {
  await login(page);
  await page.goto("/budget");

  for (let i = 0; i < 6; i++) {
    const field = page.getByLabel("Budgetbetrag").nth(i % 2);
    const amount = `${100 + i * 37}`;

    await field.fill(amount);
    await field.blur();

    await expect(page.getByText(`von ${amount}.00`).first()).toBeVisible({ timeout: 4000 });
    await expect(field).toBeEnabled();
  }

  await expect(page.getByRole("progressbar").first()).toBeVisible();
});
