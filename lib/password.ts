import { readFileSync } from "fs";
import path from "path";
import { gunzipSync } from "zlib";
import { compare } from "bcryptjs";
import { z } from "zod";
import { config } from "@/lib/config";

const COMMON_PASSWORDS_PATH = path.join(process.cwd(), "lib", "data", "common-passwords-100k.txt.gz");

let commonPasswords: Set<string> | null = null;

/**
 * Loaded once per process and kept in memory — the gzipped source is ~370KB,
 * decompressing it on every password check would be wasteful for a list that
 * never changes at runtime.
 */
function loadCommonPasswords(): Set<string> {
  if (!commonPasswords) {
    const raw = gunzipSync(readFileSync(COMMON_PASSWORDS_PATH)).toString("utf-8");
    commonPasswords = new Set(raw.split("\n").map((line) => line.trim().toLowerCase()).filter(Boolean));
  }
  return commonPasswords;
}

/**
 * Top 100k passwords from real-world breaches (SecLists' xato-net list).
 * Case-insensitive, since attackers try the obvious case variants for free.
 */
export function isCommonPassword(password: string): boolean {
  return loadCommonPasswords().has(password.toLowerCase());
}

/**
 * bcrypt only hashes the first 72 bytes of its input and silently drops the
 * rest, so two passphrases that share a 72-byte prefix produce the same hash.
 * Accepting a longer one would mean telling the user their 100-character
 * passphrase protects the account when only part of it does.
 *
 * Counted in bytes rather than characters, because that is the limit bcrypt
 * actually applies — an "ä" costs two of them in UTF-8, which matters for the
 * German passphrases this app will see.
 */
export const MAX_PASSWORD_BYTES = 72;

/** The password rule for every place a new password is set. */
export const passwordSchema = z
  .string()
  .min(8, "Passwort muss mindestens 8 Zeichen lang sein.")
  .refine(
    (value) => new TextEncoder().encode(value).length <= MAX_PASSWORD_BYTES,
    `Passwort darf höchstens ${MAX_PASSWORD_BYTES} Bytes lang sein (Umlaute zählen doppelt).`
  )
  .refine(
    (value) => !isCommonPassword(value),
    "Dieses Passwort kommt in Listen bekannter Datenlecks vor und ist zu unsicher."
  );

// A pre-hashed dummy value so `dummyCompare` spends the same amount of time
// as a real password check, even though the comparison always fails.
const DUMMY_HASH = "$2a$10$CwTycUXWue0Thq9StjUM0uJ8I8p8vLKAxfsWWmM8XoAyxAOJgnbwe";

/** Runs a bcrypt compare against a fixed hash so response time doesn't leak whether a user exists. */
export async function dummyCompare(password: string): Promise<void> {
  await compare(password, DUMMY_HASH);
}

export const bcryptRounds = config.bcrypt.rounds;
