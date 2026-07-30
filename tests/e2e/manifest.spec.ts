import { expect, test } from "@playwright/test";

/**
 * The manifest and its icons must be readable without a session: a browser
 * decides whether the app is installable before anyone signs in. proxy.ts
 * redirects everything else to /login, and a 307 here would make the app
 * silently uninstallable with no error anywhere to explain it — which is
 * exactly the kind of thing nobody notices until they try to add it to a home
 * screen.
 */
test.describe("Web-App-Manifest", () => {
  test("ist ohne Anmeldung abrufbar", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest");

    expect(response.status()).toBe(200);

    const manifest = await response.json();
    expect(manifest.name).toBe("Haushaltsbudget");
    expect(manifest.start_url).toBe("/dashboard");
    expect(manifest.display).toBe("standalone");
  });

  test("verweist auf installierbare Icons", async ({ request }) => {
    const manifest = await (await request.get("/manifest.webmanifest")).json();

    // Chrome will not offer installation without a PNG of at least 192px.
    const sizes: string[] = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose === "maskable")).toBe(
      true
    );
  });

  for (const path of ["/icon-192.png", "/icon-512.png", "/icon.svg"]) {
    test(`${path} ist ohne Anmeldung abrufbar`, async ({ request }) => {
      const response = await request.get(path);

      expect(response.status()).toBe(200);
      // A login redirect would answer 200 with HTML, so the type is the check
      // that actually distinguishes a served icon from a served login page.
      expect(response.headers()["content-type"]).toMatch(/^image\//);
    });
  }
});
