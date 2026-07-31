import { describe, expect, it } from "vitest";
import { intervalLabel } from "@/lib/intervals";

describe("intervalLabel", () => {
  it("labels known intervals in German", () => {
    expect(intervalLabel(1)).toBe("Monatlich");
    expect(intervalLabel(3)).toBe("Quartalsweise");
    expect(intervalLabel(12)).toBe("Jährlich");
  });

  it("falls back to a generic label for unknown intervals", () => {
    expect(intervalLabel(4)).toBe("Alle 4 Monate");
  });
});
