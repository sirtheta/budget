import { compare } from "bcryptjs";
import { config } from "@/lib/config";

// A pre-hashed dummy value so `dummyCompare` spends the same amount of time
// as a real password check, even though the comparison always fails.
const DUMMY_HASH = "$2a$10$CwTycUXWue0Thq9StjUM0uJ8I8p8vLKAxfsWWmM8XoAyxAOJgnbwe";

/** Runs a bcrypt compare against a fixed hash so response time doesn't leak whether a user exists. */
export async function dummyCompare(password: string): Promise<void> {
  await compare(password, DUMMY_HASH);
}

export const bcryptRounds = config.bcrypt.rounds;
