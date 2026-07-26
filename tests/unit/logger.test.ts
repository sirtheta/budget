import { describe, expect, it } from "vitest";
import { maskEmail } from "@/lib/logger";

describe("maskEmail", () => {
  it("keeps the first character and the domain", () => {
    expect(maskEmail("neo38@bluewin.ch")).toBe("n***@bluewin.ch");
  });

  it("masks a single-character local part", () => {
    expect(maskEmail("a@example.com")).toBe("a***@example.com");
  });

  it("splits on the last @, so a quoted local part can't expose itself", () => {
    expect(maskEmail('"a@b"@example.com')).toBe('"***@example.com');
  });

  it("reveals nothing for input that isn't an address", () => {
    expect(maskEmail("@example.com")).toBe("***");
    expect(maskEmail("not-an-address")).toBe("***");
  });

  it("reports missing values instead of throwing", () => {
    expect(maskEmail(null)).toBe("unknown");
    expect(maskEmail(undefined)).toBe("unknown");
    expect(maskEmail("")).toBe("unknown");
  });
});
