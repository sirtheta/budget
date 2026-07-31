import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestDb } from "./helpers";

const { prismaHolder, sendMailMock, headersGet } = vi.hoisted(() => ({
  prismaHolder: { current: undefined as unknown },
  sendMailMock: vi.fn().mockResolvedValue(undefined),
  headersGet: vi.fn(() => null),
}));

vi.mock("@/lib/prisma", () => ({
  get default() {
    return prismaHolder.current;
  },
  getDbPath: () => "/unused",
}));
vi.mock("@/lib/email", () => ({ sendMail: sendMailMock }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => ({ get: headersGet })) }));

import { requestPasswordResetAction } from "@/app/(auth)/forgot-password/actions";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
const ORIGINAL_ENV = { ...process.env };

beforeAll(async () => {
  const db = createTestDb();
  prisma = db.prisma;
  cleanup = db.cleanup;
  prismaHolder.current = prisma;
  await prisma.user.create({
    data: { email: "active@test.ch", name: "Active User", passwordHash: "x", isActive: true },
  });
  await prisma.user.create({
    data: { email: "inactive@test.ch", name: "Inactive User", passwordHash: "x", isActive: false },
  });
});

afterAll(async () => cleanup());

beforeEach(() => {
  sendMailMock.mockClear();
  headersGet.mockReturnValue(null);
  process.env.AUTH_URL = "https://budget.example.ch";
});

function form(email: string) {
  const data = new FormData();
  data.append("email", email);
  return data;
}

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("requestPasswordResetAction", () => {
  it("rejects a malformed email without touching the database", async () => {
    const result = await requestPasswordResetAction(undefined, form("not-an-email"));
    expect(result.error).toBeTruthy();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("answers success without sending mail for an unknown address (no account enumeration)", async () => {
    const result = await requestPasswordResetAction(undefined, form("nobody@test.ch"));
    expect(result).toEqual({ success: true });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("answers success without sending mail for a deactivated account", async () => {
    const result = await requestPasswordResetAction(undefined, form("inactive@test.ch"));
    expect(result).toEqual({ success: true });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("sends a reset email with a link for an active, known account", async () => {
    // SystemSettings row is required before mail can be "sent" (buildTransport
    // is inside the mocked sendMail, but the action itself loads settings).
    await prisma.systemSettings.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
    });

    const result = await requestPasswordResetAction(undefined, form("active@test.ch"));

    expect(result).toEqual({ success: true });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const [, to, subject, text] = sendMailMock.mock.calls[0];
    expect(to).toBe("active@test.ch");
    expect(subject).toContain("Passwort zurücksetzen");
    expect(text).toContain("https://budget.example.ch/reset-password?token=");
  });

  it("still answers success when SMTP isn't configured, without throwing", async () => {
    await prisma.systemSettings.deleteMany();
    const result = await requestPasswordResetAction(undefined, form("active@test.ch"));
    expect(result).toEqual({ success: true });
  });

  it("rate-limits repeated requests for the same address", async () => {
    await prisma.systemSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
    let last;
    for (let i = 0; i < 5; i++) {
      last = await requestPasswordResetAction(undefined, form("active@test.ch"));
    }
    // Still answers generically even once throttled.
    expect(last).toEqual({ success: true });
    expect(sendMailMock.mock.calls.length).toBeLessThan(5);
  });
});
