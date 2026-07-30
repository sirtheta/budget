import { compare } from "bcryptjs";
import { z } from "zod";
import { config } from "@/lib/config";

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
  );

// A pre-hashed dummy value so `dummyCompare` spends the same amount of time
// as a real password check, even though the comparison always fails.
const DUMMY_HASH = "$2a$10$CwTycUXWue0Thq9StjUM0uJ8I8p8vLKAxfsWWmM8XoAyxAOJgnbwe";

/** Runs a bcrypt compare against a fixed hash so response time doesn't leak whether a user exists. */
export async function dummyCompare(password: string): Promise<void> {
  await compare(password, DUMMY_HASH);
}

export const bcryptRounds = config.bcrypt.rounds;
