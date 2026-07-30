import { describe, expect, it } from "vitest";
import { hash, compare } from "bcryptjs";
import { dummyCompare, bcryptRounds, passwordSchema, MAX_PASSWORD_BYTES } from "@/lib/password";

describe("dummyCompare", () => {
  it("resolves without throwing, regardless of input", async () => {
    await expect(dummyCompare("anything")).resolves.toBeUndefined();
    await expect(dummyCompare("")).resolves.toBeUndefined();
  });
});

describe("bcryptRounds", () => {
  it("is a positive integer sourced from config", () => {
    expect(Number.isInteger(bcryptRounds)).toBe(true);
    expect(bcryptRounds).toBeGreaterThan(0);
  });
});

describe("passwordSchema", () => {
  it("accepts a password of at least eight characters", () => {
    expect(passwordSchema.safeParse("geheim123").success).toBe(true);
  });

  it("rejects a short password with a German message", () => {
    const result = passwordSchema.safeParse("kurz");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "Passwort muss mindestens 8 Zeichen lang sein."
    );
  });

  it("accepts a password exactly at the byte limit", () => {
    expect(passwordSchema.safeParse("a".repeat(MAX_PASSWORD_BYTES)).success).toBe(true);
  });

  it("rejects a password past the byte limit", () => {
    expect(passwordSchema.safeParse("a".repeat(MAX_PASSWORD_BYTES + 1)).success).toBe(false);
  });

  it("counts umlauts as the two bytes bcrypt sees, not one character", () => {
    // 36 × "ä" is 36 characters but 72 bytes — right at the limit.
    expect(passwordSchema.safeParse("ä".repeat(36)).success).toBe(true);
    expect(passwordSchema.safeParse("ä".repeat(37)).success).toBe(false);
  });

  it("guards against the truncation that makes the limit necessary", async () => {
    // Demonstrates why the bound exists: bcrypt ignores everything past 72
    // bytes, so these two passphrases would otherwise share a hash and either
    // one would open the account.
    const base = "a".repeat(MAX_PASSWORD_BYTES);
    const hashed = await hash(`${base}erster-zusatz`, 4);

    expect(await compare(`${base}zweiter-zusatz`, hashed)).toBe(true);
    expect(passwordSchema.safeParse(`${base}erster-zusatz`).success).toBe(false);
  });
});
