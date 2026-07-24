import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import logger from "@/lib/logger";

const log = logger.child({ module: "crypto" });

const PREFIX = "enc:v1:";
// Static application salt: the input (ENCRYPTION_KEY) is itself high-entropy,
// the salt only prevents key reuse across applications.
const KEY_SALT = "budget-secret-encryption-v1";

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      // validateEnv() already enforces ENCRYPTION_KEY in production at startup
      throw new Error("ENCRYPTION_KEY must be set in production");
    }
    log.warn("ENCRYPTION_KEY not set — using insecure development encryption key");
  }
  cachedKey = scryptSync(secret ?? "insecure-development-encryption-key", KEY_SALT, 32);
  return cachedKey;
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

/**
 * Encrypts a secret for storage at rest (AES-256-GCM, key derived from
 * ENCRYPTION_KEY). Empty and already-encrypted values pass through unchanged.
 */
export function encryptSecret(plain: string): string {
  if (!plain || isEncrypted(plain)) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

/**
 * Decrypts a stored secret. Values without the encryption prefix are returned
 * unchanged. Returns "" when decryption fails (e.g. ENCRYPTION_KEY changed) so
 * callers treat the secret as unset instead of using ciphertext as a credential.
 */
export function decryptSecret(stored: string): string {
  if (!stored) return stored;
  if (!isEncrypted(stored)) {
    // Legacy passthrough for rows written before encryption existed. Flag it:
    // a plaintext credential in the DB should be re-saved (which encrypts it).
    log.warn("Stored secret is not encrypted — re-save it in the settings to encrypt it at rest");
    return stored;
  }
  try {
    const [ivB64, tagB64, dataB64] = stored.slice(PREFIX.length).split(":");
    const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch (err) {
    log.error(
      { err },
      "Failed to decrypt stored secret — ENCRYPTION_KEY may have changed; re-enter the secret in the settings"
    );
    return "";
  }
}
