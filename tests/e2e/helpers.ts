import { expect, type Page } from "@playwright/test";
import { E2E_ADMIN } from "./global-setup";

export async function login(
  page: Page,
  { email, password }: { email: string; password: string } = E2E_ADMIN
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL("**/dashboard**");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}
