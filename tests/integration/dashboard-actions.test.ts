import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hash } from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
import { createTestDb } from "./helpers";

const { prismaHolder, sessionHolder, signOutMock } = vi.hoisted(() => ({
  prismaHolder: { current: undefined as unknown },
  sessionHolder: { current: { user: { id: "1", role: "Viewer", name: "Test", email: "t@test.ch" } } },
  signOutMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/prisma", () => ({
  get default() {
    return prismaHolder.current;
  },
  getDbPath: () => "/unused",
}));
vi.mock("@/lib/permissions", () => ({
  requireSession: vi.fn(async () => sessionHolder.current),
}));
vi.mock("@/lib/auth", () => ({ signOut: signOutMock }));

import {
  signOutAction,
  changeOwnPasswordAction,
  startTwoFactorSetupAction,
  confirmTwoFactorSetupAction,
  disableTwoFactorAction,
} from "@/app/(app)/actions";
import { generateTwoFactorSecret, twoFactorKeyUri } from "@/lib/two-factor";
import { TOTP, Secret } from "otpauth";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

async function newUser(email: string, password = "correct-password") {
  const user = await prisma.user.create({
    data: { email, name: "Test", passwordHash: await hash(password, 4) },
  });
  sessionHolder.current = { user: { id: String(user.id), role: "Viewer", name: "Test", email } };
  return user;
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

beforeAll(async () => {
  const db = createTestDb();
  prisma = db.prisma;
  cleanup = db.cleanup;
  prismaHolder.current = prisma;
});

afterAll(async () => cleanup());

describe("signOutAction", () => {
  it("delegates to next-auth's signOut", async () => {
    await signOutAction();
    expect(signOutMock).toHaveBeenCalledWith({ redirectTo: "/login" });
  });
});

describe("changeOwnPasswordAction", () => {
  it("rejects a new password shorter than 8 characters", async () => {
    await newUser("pw1@test.ch");
    const result = await changeOwnPasswordAction(
      undefined,
      form({ currentPassword: "correct-password", newPassword: "short" })
    );
    expect(result.error).toMatch(/mindestens 8/);
  });

  it("rejects the wrong current password", async () => {
    await newUser("pw2@test.ch");
    const result = await changeOwnPasswordAction(
      undefined,
      form({ currentPassword: "wrong-password", newPassword: "brandNewPw1" })
    );
    expect(result.error).toBe("Aktuelles Passwort ist falsch.");
  });

  it("changes the password, bumps sessionEpoch, and logs an audit entry", async () => {
    const user = await newUser("pw3@test.ch");
    const result = await changeOwnPasswordAction(
      undefined,
      form({ currentPassword: "correct-password", newPassword: "brandNewPw1" })
    );
    expect(result).toEqual({ success: true });
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.sessionEpoch).toBe(1);
    const audit = await prisma.auditLog.findFirst({
      where: { userId: user.id, details: { contains: "changeOwnPassword" } },
    });
    expect(audit).toBeTruthy();
  });
});

describe("two-factor setup / confirm / disable", () => {
  it("starts setup with a fresh secret and QR code", async () => {
    await newUser("tfa1@test.ch");
    const result = await startTwoFactorSetupAction();
    expect(result.secret).toBeTruthy();
    expect(result.qrDataUrl).toMatch(/^data:image\/png;base64,/);

    const user = await prisma.user.findFirstOrThrow({ where: { email: "tfa1@test.ch" } });
    expect(user.twoFactorEnabled).toBe(false);
    expect(user.twoFactorSecret).toBeTruthy();
  });

  it("refuses to restart setup while 2FA is already active", async () => {
    const user = await newUser("tfa2@test.ch");
    await prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
    const result = await startTwoFactorSetupAction();
    expect(result.error).toMatch(/bereits aktiv/);
  });

  it("rejects confirmation when no setup was started", async () => {
    await newUser("tfa3@test.ch");
    const result = await confirmTwoFactorSetupAction(undefined, form({ code: "123456" }));
    expect(result.error).toBe("Kein Setup gestartet.");
  });

  it("rejects an invalid confirmation code", async () => {
    await newUser("tfa4@test.ch");
    await startTwoFactorSetupAction();
    const result = await confirmTwoFactorSetupAction(undefined, form({ code: "000000" }));
    expect(result.error).toBe("Code ist ungültig.");
  });

  it("confirms setup with a valid code and returns backup codes", async () => {
    const user = await newUser("tfa5@test.ch");
    const setup = await startTwoFactorSetupAction();
    const token = new TOTP({ secret: Secret.fromBase32(setup.secret!) }).generate();

    const result = await confirmTwoFactorSetupAction(undefined, form({ code: token }));
    expect(result.backupCodes).toHaveLength(10);

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.twoFactorEnabled).toBe(true);
  });

  it("rejects disabling 2FA with the wrong password", async () => {
    const user = await newUser("tfa6@test.ch");
    const setup = await startTwoFactorSetupAction();
    const token = new TOTP({ secret: Secret.fromBase32(setup.secret!) }).generate();
    await confirmTwoFactorSetupAction(undefined, form({ code: token }));
    sessionHolder.current = { user: { id: String(user.id), role: "Viewer", name: "Test", email: "tfa6@test.ch" } };

    const result = await disableTwoFactorAction(undefined, form({ password: "wrong-password" }));
    expect(result.error).toBe("Passwort ist falsch.");
  });

  it("disables 2FA with the correct password, bumping sessionEpoch", async () => {
    const user = await newUser("tfa7@test.ch");
    const setup = await startTwoFactorSetupAction();
    const token = new TOTP({ secret: Secret.fromBase32(setup.secret!) }).generate();
    await confirmTwoFactorSetupAction(undefined, form({ code: token }));
    sessionHolder.current = { user: { id: String(user.id), role: "Viewer", name: "Test", email: "tfa7@test.ch" } };

    const result = await disableTwoFactorAction(undefined, form({ password: "correct-password" }));
    expect(result).toEqual({ success: true });

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.twoFactorEnabled).toBe(false);
    expect(updated.twoFactorSecret).toBeNull();
    expect(updated.sessionEpoch).toBe(1);
  });
});

// Sanity check that the local two-factor helpers used to build the test
// tokens behave as this suite assumes.
describe("twoFactorKeyUri sanity", () => {
  it("produces a URI containing the secret", () => {
    const secret = generateTwoFactorSecret();
    expect(twoFactorKeyUri(secret, "a@b.ch")).toContain(secret);
  });
});
