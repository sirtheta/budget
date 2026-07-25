import { randomBytes } from "crypto";
import { hash, compare } from "bcryptjs";
import { Secret, TOTP } from "otpauth";
import { bcryptRounds } from "@/lib/password";

const ISSUER = "Haushaltsbudget";
const BACKUP_CODE_COUNT = 10;

function totp(secret: string, label: string): TOTP {
  return new TOTP({ issuer: ISSUER, label, secret: Secret.fromBase32(secret) });
}

/** Generates a new base32 TOTP secret for a pending 2FA setup. */
export function generateTwoFactorSecret(): string {
  return new Secret({ size: 20 }).base32;
}

/** otpauth:// URI for the authenticator app's QR code / manual entry. */
export function twoFactorKeyUri(secret: string, email: string): string {
  return totp(secret, email).toString();
}

/**
 * Verifies a 6-digit TOTP code, allowing one 30s step of clock drift either
 * way. Returns false for malformed input rather than throwing, since it's
 * always user-typed.
 */
export function verifyTwoFactorToken(secret: string, token: string): boolean {
  if (!/^\d{6}$/.test(token)) return false;
  const delta = totp(secret, "").validate({ token, window: 1 });
  return delta !== null;
}

/** Plaintext one-time recovery codes, shown to the user exactly once. */
export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(5).toString("hex").toUpperCase(); // 10 hex chars
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

/** Hashes backup codes for storage, same as a password — never kept in plaintext. */
export async function hashBackupCodes(codes: string[]): Promise<string> {
  const hashed = await Promise.all(codes.map((code) => hash(code, bcryptRounds)));
  return JSON.stringify(hashed);
}

/**
 * Checks a backup code against the stored hashes and, if it matches, returns
 * the remaining set with that one removed (each code works once).
 */
export async function consumeBackupCode(
  storedJson: string | null,
  code: string
): Promise<{ ok: boolean; remaining: string } | null> {
  if (!storedJson) return null;
  const normalized = code.trim().toUpperCase();
  let hashes: string[];
  try {
    hashes = JSON.parse(storedJson);
  } catch {
    return null;
  }
  for (let i = 0; i < hashes.length; i++) {
    if (await compare(normalized, hashes[i])) {
      const remaining = [...hashes.slice(0, i), ...hashes.slice(i + 1)];
      return { ok: true, remaining: JSON.stringify(remaining) };
    }
  }
  return null;
}
