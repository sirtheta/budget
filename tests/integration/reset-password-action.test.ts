import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createPasswordResetToken } from "@/lib/password-reset";
import { createTestDb } from "./helpers";

const { prismaHolder, headersGet } = vi.hoisted(() => ({
  prismaHolder: { current: undefined as unknown },
  headersGet: vi.fn(() => null),
}));

vi.mock("@/lib/prisma", () => ({
  get default() {
    return prismaHolder.current;
  },
  getDbPath: () => "/unused",
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => ({ get: headersGet })) }));

import { resetPasswordAction } from "@/app/(auth)/reset-password/actions";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const db = createTestDb();
  prisma = db.prisma;
  cleanup = db.cleanup;
  prismaHolder.current = prisma;
});

afterAll(async () => cleanup());

async function newUser(email: string) {
  return prisma.user.create({
    data: { email, name: "Reset Test", passwordHash: "old-hash", sessionEpoch: 0 },
  });
}

function form(fields: { token: string; password: string; passwordConfirm?: string }) {
  const data = new FormData();
  data.append("token", fields.token);
  data.append("password", fields.password);
  data.append("passwordConfirm", fields.passwordConfirm ?? fields.password);
  return data;
}

describe("resetPasswordAction", () => {
  it("rejects a password shorter than 8 characters", async () => {
    const result = await resetPasswordAction(undefined, form({ token: "x", password: "short" }));
    expect(result.error).toMatch(/mindestens 8/);
  });

  it("rejects mismatched password confirmation", async () => {
    const result = await resetPasswordAction(
      undefined,
      form({ token: "x", password: "longenough1", passwordConfirm: "different1" })
    );
    expect(result.error).toBe("Die Passwörter stimmen nicht überein.");
  });

  it("rejects an unknown token", async () => {
    const result = await resetPasswordAction(
      undefined,
      form({ token: "made-up-token", password: "longenough1" })
    );
    expect(result.error).toMatch(/ungültig oder abgelaufen/);
  });

  it("resets the password, bumps sessionEpoch, and writes an audit row", async () => {
    const user = await newUser("reset1@test.ch");
    const token = await createPasswordResetToken(prisma, user.id);

    const result = await resetPasswordAction(undefined, form({ token, password: "brandNewPw1" }));

    expect(result).toEqual({ success: true });
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.passwordHash).not.toBe("old-hash");
    expect(updated.sessionEpoch).toBe(1);

    const audit = await prisma.auditLog.findFirst({ where: { userId: user.id, entityType: "User" } });
    expect(audit?.action).toBe("UPDATE");
    expect(audit?.details).toContain("passwordReset");
  });

  it("cannot reuse a token that was already consumed", async () => {
    const user = await newUser("reset2@test.ch");
    const token = await createPasswordResetToken(prisma, user.id);
    await resetPasswordAction(undefined, form({ token, password: "firstNewPw1" }));

    const result = await resetPasswordAction(undefined, form({ token, password: "secondNewPw1" }));
    expect(result.error).toMatch(/ungültig oder abgelaufen/);
  });
});
