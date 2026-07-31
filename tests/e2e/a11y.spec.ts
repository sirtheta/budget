import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

/**
 * Automated accessibility checks over the pages the household actually lives
 * in. Nothing checked this before, so regressions — an icon-only button losing
 * its label, a form control losing its association — could only be found by
 * someone hitting them.
 *
 * Scoped to WCAG 2.1 A and AA, which is the level worth holding a small
 * self-hosted app to. axe only finds the machine-checkable subset of
 * accessibility problems; a clean run is a floor, not a certificate.
 */
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function violations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  // Re-shaped before asserting: the raw report is enormous, and a failure
  // should name the rule and the element rather than dump the whole tree.
  return violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.map((node) => node.target.join(" ")),
  }));
}

test.describe("Barrierefreiheit", () => {
  test("Anmeldeseite", async ({ page }) => {
    await page.goto("/login");
    expect(await violations(page)).toEqual([]);
  });

  for (const [path, name] of [
    ["/dashboard", "Übersicht"],
    ["/transactions", "Buchungen"],
    ["/budget", "Budget"],
    ["/reserves", "Rückstellungen"],
    ["/accounts", "Konten"],
    ["/import", "Import"],
  ] as const) {
    test(name, async ({ page }) => {
      await login(page);
      await page.goto(path);
      expect(await violations(page)).toEqual([]);
    });
  }

  test("Dialog zum Erfassen einer Buchung", async ({ page }) => {
    // Dialogs are the easiest thing to get wrong — focus handling, labelling
    // and the accessible name all come from markup that is only mounted here.
    await login(page);
    await page.goto("/transactions");
    await page.getByRole("button", { name: "Neue Buchung" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    expect(await violations(page)).toEqual([]);
  });
});
