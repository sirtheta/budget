import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestDb } from "./helpers";

const { prismaHolder, sessionHolder, revalidatePathMock } = vi.hoisted(() => ({
  prismaHolder: { current: undefined as unknown },
  sessionHolder: { current: { user: { id: "1", role: "Admin", name: "Admin", email: "admin@test.ch" } } },
  revalidatePathMock: vi.fn(),
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

import { saveUserAction, toggleUserActiveAction, deleteUserAction } from "@/app/(app)/users/actions";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
let adminId: number;

beforeAll(async () => {
  const db = createTestDb();
  prisma = db.prisma;
  cleanup = db.cleanup;
  prismaHolder.current = prisma;

  const admin = await prisma.user.create({
    data: { email: "admin@test.ch", name: "Admin", passwordHash: "x", role: "Admin" },
  });
  adminId = admin.id;
  sessionHolder.current = {
    user: { id: String(adminId), role: "Admin", name: "Admin", email: "admin@test.ch" },
  };
});

afterAll(async () => cleanup());

afterEach(() => {
  revalidatePathMock.mockClear();
});

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

describe("saveUserAction", () => {
  it("rejects an invalid email", async () => {
    const result = await saveUserAction(
      undefined,
      form({ email: "not-an-email", name: "X", role: "Viewer", password: "longenough1" })
    );
    expect(result.error).toBeTruthy();
  });

  it("requires a password of at least 8 characters when creating a user", async () => {
    const result = await saveUserAction(
      undefined,
      form({ email: "new@test.ch", name: "New", role: "Viewer", password: "short" })
    );
    expect(result.error).toMatch(/mindestens 8/);
  });

  it("creates a user and logs an audit entry", async () => {
    const result = await saveUserAction(
      undefined,
      form({ email: "new@test.ch", name: "New Viewer", role: "Viewer", password: "longenough1" })
    );
    expect(result).toEqual({ success: true });
    expect(revalidatePathMock).toHaveBeenCalledWith("/users");

    const created = await prisma.user.findUniqueOrThrow({ where: { email: "new@test.ch" } });
    expect(created.role).toBe("Viewer");

    const audit = await prisma.auditLog.findFirst({ where: { entityId: created.id, action: "CREATE" } });
    expect(audit).toBeTruthy();
  });

  it("rejects a duplicate email with a friendly message", async () => {
    const result = await saveUserAction(
      undefined,
      form({ email: "new@test.ch", name: "Dup", role: "Viewer", password: "longenough1" })
    );
    expect(result.error).toBe("Diese E-Mail-Adresse wird bereits verwendet.");
  });

  it("updates an existing user without touching the password when none is given", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "new@test.ch" } });
    const before = user.passwordHash;

    const result = await saveUserAction(
      undefined,
      form({ id: String(user.id), email: "new@test.ch", name: "Renamed", role: "Editor", password: "" })
    );

    expect(result).toEqual({ success: true });
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.name).toBe("Renamed");
    expect(updated.role).toBe("Editor");
    expect(updated.passwordHash).toBe(before);
  });

  it("prevents an admin from removing their own Admin role", async () => {
    const result = await saveUserAction(
      undefined,
      form({ id: String(adminId), email: "admin@test.ch", name: "Admin", role: "Viewer", password: "" })
    );
    expect(result.error).toBe("Du kannst dir die Admin-Rolle nicht selbst entziehen.");
  });
});

describe("toggleUserActiveAction", () => {
  it("prevents an admin from deactivating themselves", async () => {
    const result = await toggleUserActiveAction(adminId, false);
    expect(result.error).toBe("Du kannst dich nicht selbst deaktivieren.");
  });

  it("prevents deactivating the last active admin", async () => {
    const other = await prisma.user.create({
      data: { email: "other-admin@test.ch", name: "Other Admin", passwordHash: "x", role: "Admin" },
    });
    // Deactivate every other admin first so `other` becomes the last one.
    await prisma.user.update({ where: { id: adminId }, data: { isActive: false } });
    const result = await toggleUserActiveAction(other.id, false);
    expect(result.error).toBe("Es muss mindestens ein aktiver Admin bestehen bleiben.");
    await prisma.user.update({ where: { id: adminId }, data: { isActive: true } });
  });

  it("deactivates a non-admin user and logs an audit entry", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "new@test.ch" } });
    const result = await toggleUserActiveAction(user.id, false);
    expect(result).toEqual({ success: true });
    expect(revalidatePathMock).toHaveBeenCalledWith("/users");
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.isActive).toBe(false);
  });
});

describe("deleteUserAction", () => {
  it("prevents an admin from deleting themselves", async () => {
    const result = await deleteUserAction(adminId);
    expect(result.error).toBe("Du kannst dich nicht selbst löschen.");
  });

  it("deletes a user and logs an audit entry, keeping their id out of the way", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "new@test.ch" } });
    const result = await deleteUserAction(user.id);
    expect(result).toEqual({ success: true });
    await expect(prisma.user.findUniqueOrThrow({ where: { id: user.id } })).rejects.toBeTruthy();
    const audit = await prisma.auditLog.findFirst({ where: { entityId: user.id, action: "DELETE" } });
    expect(audit).toBeTruthy();
  });

  it("prevents deleting the last active admin", async () => {
    const other = await prisma.user.findUniqueOrThrow({ where: { email: "other-admin@test.ch" } });
    await prisma.user.update({ where: { id: adminId }, data: { isActive: false } });
    const result = await deleteUserAction(other.id);
    expect(result.error).toBe("Es muss mindestens ein aktiver Admin bestehen bleiben.");
    await prisma.user.update({ where: { id: adminId }, data: { isActive: true } });
  });
});
