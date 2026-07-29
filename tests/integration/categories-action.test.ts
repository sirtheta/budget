import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestDb } from "./helpers";

const { prismaHolder, sessionHolder, revalidatePathMock } = vi.hoisted(() => ({
  prismaHolder: { current: undefined as unknown },
  sessionHolder: { current: { user: { id: "1", role: "Editor", name: "Editor", email: "e@test.ch" } } },
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  get default() {
    return prismaHolder.current;
  },
  getDbPath: () => "/unused",
}));
vi.mock("@/lib/permissions", () => ({
  requireEditor: vi.fn(async () => sessionHolder.current),
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import {
  saveCategoryAction,
  toggleCategoryActiveAction,
  deleteCategoryAction,
  seedDefaultCategoriesAction,
} from "@/app/(app)/categories/actions";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const db = createTestDb();
  prisma = db.prisma;
  cleanup = db.cleanup;
  prismaHolder.current = prisma;
  const editor = await prisma.user.create({
    data: { email: "e@test.ch", name: "Editor", passwordHash: "x", role: "Editor" },
  });
  sessionHolder.current = {
    user: { id: String(editor.id), role: "Editor", name: "Editor", email: "e@test.ch" },
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

describe("saveCategoryAction", () => {
  it("rejects an empty name", async () => {
    const result = await saveCategoryAction(undefined, form({ name: "", kind: "Expense" }));
    expect(result.error).toBeTruthy();
  });

  it("creates a top-level category and logs an audit entry", async () => {
    const result = await saveCategoryAction(undefined, form({ name: "Wohnen", kind: "Expense" }));
    expect(result.success).toBe(true);
    expect(result.id).toBeTruthy();
    expect(revalidatePathMock).toHaveBeenCalledWith("/categories");
    expect(revalidatePathMock).toHaveBeenCalledWith("/budget");

    const audit = await prisma.auditLog.findFirst({ where: { entityId: result.id, action: "CREATE" } });
    expect(audit).toBeTruthy();
  });

  it("rejects a duplicate name on the same level", async () => {
    const result = await saveCategoryAction(undefined, form({ name: "Wohnen", kind: "Expense" }));
    expect(result.error).toMatch(/existiert bereits/);
  });

  it("creates a child category under an existing parent", async () => {
    const parent = await prisma.category.findFirstOrThrow({ where: { name: "Wohnen" } });
    const result = await saveCategoryAction(
      undefined,
      form({ name: "Miete", kind: "Expense", parentId: String(parent.id) })
    );
    expect(result.success).toBe(true);
  });

  it("rejects a category nested more than two levels deep", async () => {
    const child = await prisma.category.findFirstOrThrow({ where: { name: "Miete" } });
    const result = await saveCategoryAction(
      undefined,
      form({ name: "Zu tief", kind: "Expense", parentId: String(child.id) })
    );
    expect(result.error).toMatch(/zwei Ebenen/);
  });

  it("rejects an unknown parent", async () => {
    const result = await saveCategoryAction(
      undefined,
      form({ name: "Verwaist", kind: "Expense", parentId: "999999" })
    );
    expect(result.error).toBe("Übergeordnete Kategorie nicht gefunden.");
  });

  it("rejects a category being made its own parent", async () => {
    const parent = await prisma.category.findFirstOrThrow({ where: { name: "Wohnen" } });
    const result = await saveCategoryAction(
      undefined,
      form({ id: String(parent.id), name: "Wohnen", kind: "Expense", parentId: String(parent.id) })
    );
    expect(result.error).toMatch(/nicht selbst übergeordnet/);
  });

  it("blocks changing kind once transactions are booked on the category", async () => {
    const category = await prisma.category.findFirstOrThrow({ where: { name: "Miete" } });
    const account = await prisma.account.create({
      data: { name: "Konto", type: "Checking", openingBalanceCents: 0 },
    });
    await prisma.transaction.create({
      data: {
        date: "2026-01-01",
        amountCents: -1000,
        accountId: account.id,
        categoryId: category.id,
        description: "Test",
      },
    });

    const result = await saveCategoryAction(
      undefined,
      form({ id: String(category.id), name: "Miete", kind: "Income" })
    );
    expect(result.error).toMatch(/Art kann nicht geändert werden/);
  });

  it("updates a category and logs an audit entry", async () => {
    const category = await prisma.category.findFirstOrThrow({ where: { name: "Miete" } });
    const result = await saveCategoryAction(
      undefined,
      form({
        id: String(category.id),
        name: "Miete/Hypothek",
        kind: "Expense",
        parentId: String(category.parentId),
      })
    );
    expect(result).toEqual({ success: true });
    const audit = await prisma.auditLog.findFirst({ where: { entityId: category.id, action: "UPDATE" } });
    expect(audit).toBeTruthy();
  });
});

describe("toggleCategoryActiveAction", () => {
  it("deactivates a category and logs an audit entry", async () => {
    const category = await prisma.category.findFirstOrThrow({ where: { name: "Wohnen" } });
    const result = await toggleCategoryActiveAction(category.id, false);
    expect(result).toEqual({ success: true });
    const updated = await prisma.category.findUniqueOrThrow({ where: { id: category.id } });
    expect(updated.isActive).toBe(false);
  });
});

describe("deleteCategoryAction", () => {
  it("refuses to delete a category with sub-categories", async () => {
    const parent = await prisma.category.findFirstOrThrow({ where: { name: "Wohnen" } });
    const result = await deleteCategoryAction(parent.id);
    expect(result.error).toMatch(/Unterkategorie/);
  });

  it("refuses to delete a category with booked transactions", async () => {
    const child = await prisma.category.findFirstOrThrow({ where: { name: "Miete/Hypothek" } });
    const result = await deleteCategoryAction(child.id);
    expect(result.error).toMatch(/Buchung/);
  });

  it("deletes an unused, childless category and logs an audit entry", async () => {
    const category = await prisma.category.create({ data: { name: "Löschbar", kind: "Expense" } });
    const result = await deleteCategoryAction(category.id);
    expect(result).toEqual({ success: true });
    await expect(prisma.category.findUniqueOrThrow({ where: { id: category.id } })).rejects.toBeTruthy();
  });
});

describe("seedDefaultCategoriesAction", () => {
  it("seeds the default tree once and logs an audit entry", async () => {
    await prisma.category.deleteMany();
    const result = await seedDefaultCategoriesAction();
    expect(result.success).toBe(true);
    expect(result.created).toBeGreaterThan(0);
    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "Category", details: { contains: "seedDefaults" } },
    });
    expect(audit).toBeTruthy();
  });
});
