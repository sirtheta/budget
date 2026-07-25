import { describe, expect, it } from "vitest";
import { TOTP, Secret } from "otpauth";
import {
  generateTwoFactorSecret,
  twoFactorKeyUri,
  verifyTwoFactorToken,
  generateBackupCodes,
  hashBackupCodes,
  consumeBackupCode,
} from "@/lib/two-factor";

describe("generateTwoFactorSecret", () => {
  it("returns a distinct base32 secret each time", () => {
    const a = generateTwoFactorSecret();
    const b = generateTwoFactorSecret();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Z2-7]+$/);
  });
});

describe("twoFactorKeyUri", () => {
  it("embeds issuer, label and secret in an otpauth:// URI", () => {
    const secret = generateTwoFactorSecret();
    const uri = twoFactorKeyUri(secret, "user@example.ch");
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain("Haushaltsbudget");
    expect(decodeURIComponent(uri)).toContain("user@example.ch");
  });
});

describe("verifyTwoFactorToken", () => {
  it("accepts the current code for the secret", () => {
    const secret = generateTwoFactorSecret();
    const token = new TOTP({ secret: Secret.fromBase32(secret) }).generate();
    expect(verifyTwoFactorToken(secret, token)).toBe(true);
  });

  it("rejects a code generated from a different secret", () => {
    const secret = generateTwoFactorSecret();
    const otherToken = new TOTP({ secret: Secret.fromBase32(generateTwoFactorSecret()) }).generate();
    expect(verifyTwoFactorToken(secret, otherToken)).toBe(false);
  });

  it("rejects malformed input without throwing", () => {
    const secret = generateTwoFactorSecret();
    expect(verifyTwoFactorToken(secret, "abc")).toBe(false);
    expect(verifyTwoFactorToken(secret, "")).toBe(false);
    expect(verifyTwoFactorToken(secret, "12345")).toBe(false);
  });
});

describe("backup codes", () => {
  it("generates the requested number of unique formatted codes", () => {
    const codes = generateBackupCodes(10);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/);
  });

  it("consumes a valid code exactly once and rejects a reused one", async () => {
    const codes = generateBackupCodes(3);
    const stored = await hashBackupCodes(codes);

    const first = await consumeBackupCode(stored, codes[0]);
    expect(first?.ok).toBe(true);

    const second = await consumeBackupCode(first!.remaining, codes[0]);
    expect(second).toBeNull();
  });

  it("is case-insensitive and tolerates surrounding whitespace", async () => {
    const codes = generateBackupCodes(1);
    const stored = await hashBackupCodes(codes);
    const result = await consumeBackupCode(stored, `  ${codes[0].toLowerCase()}  `);
    expect(result?.ok).toBe(true);
  });

  it("returns null for an unknown code or missing store", async () => {
    const codes = generateBackupCodes(1);
    const stored = await hashBackupCodes(codes);
    expect(await consumeBackupCode(stored, "00000-00000")).toBeNull();
    expect(await consumeBackupCode(null, codes[0])).toBeNull();
  });
});
