import { afterEach, describe, expect, it } from "vitest";
import { clientIp } from "@/lib/client-ip";

/** Minimal stand-in for Next's ReadonlyHeaders. */
function headers(forwardedFor?: string) {
  return { get: (name: string) => (name === "x-forwarded-for" ? (forwardedFor ?? null) : null) };
}

afterEach(() => {
  delete process.env.TRUST_PROXY_HEADERS;
});

describe("clientIp", () => {
  it("ignores the header when no proxy is configured", () => {
    // The whole point: unconfigured, an attacker choosing their own bucket key
    // must not be able to do so.
    expect(clientIp(headers("1.2.3.4"))).toBeNull();
  });

  it.each(["false", "0", ""])("treats %j as no proxy", (value) => {
    process.env.TRUST_PROXY_HEADERS = value;
    expect(clientIp(headers("1.2.3.4"))).toBeNull();
  });

  it("takes the entry the single trusted proxy appended", () => {
    process.env.TRUST_PROXY_HEADERS = "true";
    // The client claimed "9.9.9.9"; our proxy appended what it really saw.
    expect(clientIp(headers("9.9.9.9, 1.2.3.4"))).toBe("1.2.3.4");
  });

  it("counts back from the right with several proxies", () => {
    process.env.TRUST_PROXY_HEADERS = "2";
    expect(clientIp(headers("9.9.9.9, 1.2.3.4, 10.0.0.1"))).toBe("1.2.3.4");
  });

  it("falls back to the leftmost entry when the chain is shorter than configured", () => {
    process.env.TRUST_PROXY_HEADERS = "3";
    expect(clientIp(headers("1.2.3.4"))).toBe("1.2.3.4");
  });

  it("returns null for a missing, empty or header-less request", () => {
    process.env.TRUST_PROXY_HEADERS = "1";
    expect(clientIp(headers())).toBeNull();
    expect(clientIp(headers("   "))).toBeNull();
    expect(clientIp(undefined)).toBeNull();
  });

  it("trims whitespace around the chosen entry", () => {
    process.env.TRUST_PROXY_HEADERS = "1";
    expect(clientIp(headers("9.9.9.9 ,  1.2.3.4 "))).toBe("1.2.3.4");
  });
});
