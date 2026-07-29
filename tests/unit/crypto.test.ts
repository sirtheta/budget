import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

// getKey() caches its derived key per module instance, so each scenario that
// depends on ENCRYPTION_KEY / NODE_ENV needs a fresh module load.
async function loadCrypto() {
  return import("@/lib/crypto");
}

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a secret", async () => {
    process.env.ENCRYPTION_KEY = "a".repeat(32);
    const { encryptSecret, decryptSecret, isEncrypted } = await loadCrypto();
    const encrypted = encryptSecret("hunter2");
    expect(isEncrypted(encrypted)).toBe(true);
    expect(encrypted).not.toBe("hunter2");
    expect(decryptSecret(encrypted)).toBe("hunter2");
  });

  it("produces a different ciphertext each time (random IV)", async () => {
    process.env.ENCRYPTION_KEY = "a".repeat(32);
    const { encryptSecret } = await loadCrypto();
    expect(encryptSecret("hunter2")).not.toBe(encryptSecret("hunter2"));
  });

  it("passes an empty string through unchanged", async () => {
    process.env.ENCRYPTION_KEY = "a".repeat(32);
    const { encryptSecret } = await loadCrypto();
    expect(encryptSecret("")).toBe("");
  });

  it("does not double-encrypt an already-encrypted value", async () => {
    process.env.ENCRYPTION_KEY = "a".repeat(32);
    const { encryptSecret } = await loadCrypto();
    const once = encryptSecret("hunter2");
    expect(encryptSecret(once)).toBe(once);
  });

  it("passes a legacy unencrypted value through decryptSecret unchanged", async () => {
    process.env.ENCRYPTION_KEY = "a".repeat(32);
    const { decryptSecret } = await loadCrypto();
    expect(decryptSecret("plaintext-password")).toBe("plaintext-password");
  });

  it("passes an empty stored value through unchanged", async () => {
    process.env.ENCRYPTION_KEY = "a".repeat(32);
    const { decryptSecret } = await loadCrypto();
    expect(decryptSecret("")).toBe("");
  });

  it("returns an empty string when the key has changed since encryption", async () => {
    process.env.ENCRYPTION_KEY = "a".repeat(32);
    const { encryptSecret } = await loadCrypto();
    const encrypted = encryptSecret("hunter2");

    vi.resetModules();
    process.env.ENCRYPTION_KEY = "b".repeat(32);
    const { decryptSecret } = await loadCrypto();
    expect(decryptSecret(encrypted)).toBe("");
  });

  it("returns an empty string for corrupted ciphertext", async () => {
    process.env.ENCRYPTION_KEY = "a".repeat(32);
    const { decryptSecret } = await loadCrypto();
    expect(decryptSecret("enc:v1:not:valid:base64!!")).toBe("");
  });

  it("falls back to an insecure development key outside production when unset", async () => {
    delete process.env.ENCRYPTION_KEY;
    vi.stubEnv("NODE_ENV", "development");
    const { encryptSecret, decryptSecret } = await loadCrypto();
    const encrypted = encryptSecret("hunter2");
    expect(decryptSecret(encrypted)).toBe("hunter2");
  });

  it("throws in production when ENCRYPTION_KEY is unset", async () => {
    delete process.env.ENCRYPTION_KEY;
    vi.stubEnv("NODE_ENV", "production");
    const { encryptSecret } = await loadCrypto();
    expect(() => encryptSecret("hunter2")).toThrow("ENCRYPTION_KEY must be set in production");
  });
});
