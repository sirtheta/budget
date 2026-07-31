import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestDb } from "./helpers";
import { encryptSecret } from "@/lib/crypto";

const { prismaHolder, sessionHolder, revalidatePathMock, sendMailMock, testConnectionMock, runBackupMock } =
  vi.hoisted(() => ({
    prismaHolder: { current: undefined as unknown },
    sessionHolder: { current: { user: { id: "1", role: "Admin", name: "Admin", email: "admin@test.ch" } } },
    revalidatePathMock: vi.fn(),
    sendMailMock: vi.fn().mockResolvedValue(undefined),
    testConnectionMock: vi.fn().mockResolvedValue(undefined),
    runBackupMock: vi.fn().mockResolvedValue("/backups/budget-backup-2026-07-29.db"),
  }));

vi.mock("@/lib/prisma", () => ({
  get default() {
    return prismaHolder.current;
  },
  getDbPath: () => "/unused",
}));
vi.mock("@/lib/permissions", () => ({
  requireAdmin: vi.fn(async () => sessionHolder.current),
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/email", () => ({ sendMail: sendMailMock, testConnection: testConnectionMock }));
vi.mock("@/lib/backup", () => ({ runBackup: runBackupMock }));

import {
  saveSettingsAction,
  sendTestMailAction,
  testConnectionAction,
  runBackupNowAction,
} from "@/app/(app)/settings/actions";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const db = createTestDb();
  prisma = db.prisma;
  cleanup = db.cleanup;
  prismaHolder.current = prisma;
  await prisma.user.create({
    data: { id: 1, email: "admin@test.ch", name: "Admin", passwordHash: "x", role: "Admin" },
  });
});

afterAll(async () => cleanup());

afterEach(() => {
  revalidatePathMock.mockClear();
  sendMailMock.mockClear();
  testConnectionMock.mockClear();
  runBackupMock.mockClear();
});

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

describe("saveSettingsAction", () => {
  it("rejects a currency code that isn't 3 letters", async () => {
    const result = await saveSettingsAction(undefined, form({ currency: "CH" }));
    expect(result.error).toBeTruthy();
  });

  it("rejects an SMTP from-address that isn't a valid email", async () => {
    const result = await saveSettingsAction(
      undefined,
      form({ currency: "CHF", smtpFromAddress: "not-an-email" })
    );
    expect(result.error).toBeTruthy();
  });

  it("saves settings and logs an audit entry", async () => {
    const result = await saveSettingsAction(
      undefined,
      form({ currency: "chf", smtpHost: "smtp.example.ch", smtpUser: "user@example.ch" })
    );
    expect(result).toEqual({ success: true });
    expect(revalidatePathMock).toHaveBeenCalledWith("/settings");

    const settings = await prisma.systemSettings.findUniqueOrThrow({ where: { id: 1 } });
    expect(settings.currency).toBe("CHF");
    expect(settings.smtpHost).toBe("smtp.example.ch");

    const audit = await prisma.auditLog.findFirst({ where: { entityType: "Settings", action: "SETTINGS" } });
    expect(audit).toBeTruthy();
  });

  it("encrypts a newly-set SMTP password at rest", async () => {
    await saveSettingsAction(
      undefined,
      form({ currency: "CHF", smtpHost: "smtp.example.ch", smtpPassword: "hunter2" })
    );
    const settings = await prisma.systemSettings.findUniqueOrThrow({ where: { id: 1 } });
    expect(settings.smtpPassword).not.toBe("hunter2");
    expect(settings.smtpPassword).toMatch(/^enc:v1:/);
  });

  it("leaves the stored password untouched when the field is left blank", async () => {
    const before = await prisma.systemSettings.findUniqueOrThrow({ where: { id: 1 } });
    await saveSettingsAction(undefined, form({ currency: "CHF", smtpHost: "smtp.example.ch" }));
    const after = await prisma.systemSettings.findUniqueOrThrow({ where: { id: 1 } });
    expect(after.smtpPassword).toBe(before.smtpPassword);
  });
});

describe("sendTestMailAction", () => {
  it("fails when no settings are saved yet", async () => {
    await prisma.systemSettings.deleteMany();
    const result = await sendTestMailAction();
    expect(result.error).toBe("Es sind noch keine Einstellungen gespeichert.");
  });

  it("sends a test mail and logs an audit entry", async () => {
    await prisma.systemSettings.create({ data: { id: 1, smtpHost: "smtp.example.ch" } });
    const result = await sendTestMailAction();
    expect(result).toEqual({ success: true });
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.anything(),
      "admin@test.ch",
      expect.stringContaining("Test-E-Mail"),
      expect.any(String)
    );
    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "Settings", details: { contains: "testMail" } },
    });
    expect(audit).toBeTruthy();
  });

  it("reports the underlying error when sending fails", async () => {
    sendMailMock.mockRejectedValueOnce(new Error("SMTP nicht konfiguriert."));
    const result = await sendTestMailAction();
    expect(result.error).toBe("SMTP nicht konfiguriert.");
  });
});

describe("testConnectionAction", () => {
  it("requires host and user", async () => {
    await prisma.systemSettings.deleteMany();
    const result = await testConnectionAction(undefined, form({}));
    expect(result.error).toBe("SMTP-Server und Benutzer sind erforderlich.");
  });

  it("fails when no password is typed and none is stored", async () => {
    await prisma.systemSettings.deleteMany();
    const result = await testConnectionAction(
      undefined,
      form({ smtpHost: "smtp.example.ch", smtpUser: "user@example.ch" })
    );
    expect(result.error).toBe("SMTP-Passwort ist erforderlich.");
  });

  it("verifies unsaved form values without requiring a save first", async () => {
    await prisma.systemSettings.deleteMany();
    const result = await testConnectionAction(
      undefined,
      form({ smtpHost: "smtp.example.ch", smtpUser: "user@example.ch", smtpPassword: "hunter2" })
    );
    expect(result).toEqual({ success: true });
    expect(testConnectionMock).toHaveBeenCalledWith(
      expect.objectContaining({ smtpHost: "smtp.example.ch", smtpUser: "user@example.ch", smtpPort: 587 }),
      "hunter2"
    );
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("falls back to the stored password when the field is left blank", async () => {
    await prisma.systemSettings.create({
      data: { id: 1, smtpHost: "old.example.ch", smtpUser: "old-user", smtpPassword: encryptSecret("stored-pw") },
    });
    const result = await testConnectionAction(
      undefined,
      form({ smtpHost: "smtp.example.ch", smtpUser: "user@example.ch" })
    );
    expect(result).toEqual({ success: true });
    expect(testConnectionMock).toHaveBeenCalledWith(expect.anything(), "stored-pw");
  });

  it("reports the underlying error when verification fails", async () => {
    testConnectionMock.mockRejectedValueOnce(new Error("connection refused"));
    const result = await testConnectionAction(
      undefined,
      form({ smtpHost: "smtp.example.ch", smtpUser: "user@example.ch", smtpPassword: "hunter2" })
    );
    expect(result.error).toBe("connection refused");
  });
});

describe("runBackupNowAction", () => {
  it("runs a backup and logs an audit entry", async () => {
    const result = await runBackupNowAction();
    expect(result).toEqual({ success: true, path: "/backups/budget-backup-2026-07-29.db" });
    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "Settings", details: { contains: "manualBackup" } },
    });
    expect(audit).toBeTruthy();
  });

  it("reports the underlying error when the backup fails", async () => {
    runBackupMock.mockRejectedValueOnce(new Error("disk full"));
    const result = await runBackupNowAction();
    expect(result.error).toBe("disk full");
  });
});
