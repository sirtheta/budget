import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  hashResetToken,
  createPasswordResetToken,
  consumePasswordResetToken,
  RESET_TOKEN_TTL_MS,
} from "@/lib/password-reset";
import { createTestDb } from "./helpers";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
let userId: number;

beforeAll(async () => {
  const db = createTestDb();
  prisma = db.prisma;
  cleanup = db.cleanup;
  const user = await prisma.user.create({
    data: { email: "reset@test.ch", name: "Reset Test", passwordHash: "x" },
  });
  userId = user.id;
});

afterAll(async () => cleanup());

describe("hashResetToken", () => {
  it("is a deterministic SHA-256 hex digest", () => {
    expect(hashResetToken("abc")).toBe(hashResetToken("abc"));
    expect(hashResetToken("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashResetToken("abc")).not.toBe(hashResetToken("abd"));
  });
});

describe("createPasswordResetToken / consumePasswordResetToken", () => {
  it("issues a token that resolves back to the user id, and only once", async () => {
    const token = await createPasswordResetToken(prisma, userId);
    expect(await consumePasswordResetToken(prisma, token)).toBe(userId);
    // A second use of the same (now-consumed) token must fail.
    expect(await consumePasswordResetToken(prisma, token)).toBeNull();
  });

  it("invalidates any earlier outstanding token for the same user", async () => {
    const first = await createPasswordResetToken(prisma, userId);
    const second = await createPasswordResetToken(prisma, userId);
    expect(await consumePasswordResetToken(prisma, first)).toBeNull();
    expect(await consumePasswordResetToken(prisma, second)).toBe(userId);
  });

  it("rejects a token that has expired", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const token = await createPasswordResetToken(prisma, userId, now);
    const justAfterExpiry = new Date(now.getTime() + RESET_TOKEN_TTL_MS + 1000);
    expect(await consumePasswordResetToken(prisma, token, justAfterExpiry)).toBeNull();
  });

  it("rejects an unknown token", async () => {
    expect(await consumePasswordResetToken(prisma, "made-up-token")).toBeNull();
  });
});
