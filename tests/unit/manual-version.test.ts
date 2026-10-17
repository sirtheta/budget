import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = path.join(__dirname, "..", "..");

describe("Benutzerhandbuch version", () => {
  it("matches the app version in package.json", () => {
    const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf-8"));
    const html = readFileSync(path.join(root, "public", "benutzerhandbuch.html"), "utf-8");
    const stamped = html
      .split("\n")
      .filter((line) => line.includes("x-release-please-version"))
      .flatMap((line) => line.match(/v\d+\.\d+\.\d+/g) ?? []);

    expect(stamped.length).toBeGreaterThan(0);
    for (const v of stamped) expect(v).toBe(`v${version}`);
  });
});
