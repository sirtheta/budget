import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestDb, seedBasics } from "./helpers";

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
  saveRecurringAction,
  toggleRecurringActiveAction,
  deleteRecurringAction,
  postRecurringNowAction,
  runRecurringNowAction,
} from "@/app/(app)/recurring/actions";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
let fixtures: Awaited<ReturnType<typeof seedBasics>>;

beforeAll(async () => {
  const db = createTestDb();
  prisma = db.prisma;
  cleanup = db.cleanup;
  prismaHolder.current = prisma;
  fixtures = await seedBasics(prisma);
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

function baseFields(overrides: Record<string, string> = {}) {
  return {
    name: "Miete",
    intervalMonths: "1",
    startDate: "2026-01-01",
    accountId: String(fixtures.account.id),
    categoryId: String(fixtures.groceries.id),
    amount: "1850",
    direction: "expense",
    ...overrides,
  };
}

describe("saveRecurringAction", () => {
  it("rejects an empty name", async () => {
    const result = await saveRecurringAction(undefined, form(baseFields({ name: "" })));
    expect(result.error).toBeTruthy();
  });

  it("rejects an invalid start date", async () => {
    const result = await saveRecurringAction(undefined, form(baseFields({ startDate: "not-a-date" })));
    expect(result.error).toMatch(/Startdatum/);
  });

  it("requires an account", async () => {
    const result = await saveRecurringAction(undefined, form(baseFields({ accountId: "" })));
    expect(result.error).toBe("Bitte ein Konto auswählen.");
  });

  it("rejects a zero amount", async () => {
    const result = await saveRecurringAction(undefined, form(baseFields({ amount: "0" })));
    expect(result.error).toBe("Betrag darf nicht 0 sein.");
  });

  it("rejects an end date before the start date", async () => {
    const result = await saveRecurringAction(
      undefined,
      form(baseFields({ endDate: "2025-01-01" }))
    );
    expect(result.error).toBe("Das Enddatum liegt vor dem Startdatum.");
  });

  it("creates an expense entry and logs an audit entry", async () => {
    const result = await saveRecurringAction(undefined, form(baseFields()));
    expect(result).toEqual({ success: true });
    expect(revalidatePathMock).toHaveBeenCalledWith("/recurring");

    const row = await prisma.recurringTransaction.findFirstOrThrow({ where: { name: "Miete" } });
    expect(row.amountCents).toBe(-185000);
    expect(row.nextDate).toBe("2026-01-01");
  });

  it("stores an income entry as a positive amount", async () => {
    await saveRecurringAction(
      undefined,
      form(baseFields({ name: "Lohn", direction: "income", categoryId: String(fixtures.income.id) }))
    );
    const row = await prisma.recurringTransaction.findFirstOrThrow({ where: { name: "Lohn" } });
    expect(row.amountCents).toBe(185000);
  });

  it("requires a distinct target account for a transfer", async () => {
    const result = await saveRecurringAction(
      undefined,
      form(
        baseFields({
          name: "Umbuchung",
          mode: "transfer",
          counterAccountId: String(fixtures.account.id),
        })
      )
    );
    expect(result.error).toBe("Quell- und Zielkonto müssen unterschiedlich sein.");
  });

  it("creates a transfer entry with a positive magnitude", async () => {
    const result = await saveRecurringAction(
      undefined,
      form(
        baseFields({
          name: "Sparen",
          mode: "transfer",
          counterAccountId: String(fixtures.savings.id),
          amount: "-200",
        })
      )
    );
    expect(result).toEqual({ success: true });
    const row = await prisma.recurringTransaction.findFirstOrThrow({ where: { name: "Sparen" } });
    expect(row.amountCents).toBe(20000);
    expect(row.counterAccountId).toBe(fixtures.savings.id);
  });

  it("updates an existing entry without resetting nextDate", async () => {
    const existing = await prisma.recurringTransaction.findFirstOrThrow({ where: { name: "Miete" } });
    const result = await saveRecurringAction(
      undefined,
      form(baseFields({ id: String(existing.id), name: "Miete (neu)", startDate: "2026-06-01" }))
    );
    expect(result).toEqual({ success: true });
    const updated = await prisma.recurringTransaction.findUniqueOrThrow({ where: { id: existing.id } });
    expect(updated.name).toBe("Miete (neu)");
    expect(updated.nextDate).toBe(existing.nextDate);
  });
});

describe("toggleRecurringActiveAction / deleteRecurringAction", () => {
  it("toggles active state and logs an audit entry", async () => {
    const row = await prisma.recurringTransaction.findFirstOrThrow({ where: { name: "Lohn" } });
    const result = await toggleRecurringActiveAction(row.id, false);
    expect(result).toEqual({ success: true });
    const updated = await prisma.recurringTransaction.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.isActive).toBe(false);
  });

  it("deletes an entry and logs an audit entry", async () => {
    const row = await prisma.recurringTransaction.findFirstOrThrow({ where: { name: "Lohn" } });
    const result = await deleteRecurringAction(row.id);
    expect(result).toEqual({ success: true });
    await expect(
      prisma.recurringTransaction.findUniqueOrThrow({ where: { id: row.id } })
    ).rejects.toBeTruthy();
  });
});

describe("postRecurringNowAction", () => {
  it("returns an error for an unknown entry", async () => {
    const result = await postRecurringNowAction(999999);
    expect(result.error).toBe("Wiederkehrende Buchung nicht gefunden.");
  });

  it("posts one occurrence and advances the schedule", async () => {
    const row = await prisma.recurringTransaction.create({
      data: {
        name: "Zeitschrift",
        amountCents: -3000,
        accountId: fixtures.account.id,
        categoryId: fixtures.groceries.id,
        intervalMonths: 1,
        startDate: "2026-01-01",
        nextDate: "2026-01-01",
        autoPost: false,
      },
    });

    const result = await postRecurringNowAction(row.id);
    expect(result).toEqual({ success: true });

    const updated = await prisma.recurringTransaction.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.nextDate).toBe("2026-02-01");

    const posted = await prisma.transaction.findFirst({ where: { recurringId: row.id } });
    expect(posted?.amountCents).toBe(-3000);
  });

  it("deactivates the entry once posting exhausts its end date", async () => {
    const row = await prisma.recurringTransaction.create({
      data: {
        name: "Auslaufend",
        amountCents: -1000,
        accountId: fixtures.account.id,
        categoryId: fixtures.groceries.id,
        intervalMonths: 1,
        startDate: "2026-01-01",
        nextDate: "2026-01-01",
        endDate: "2026-01-15",
        autoPost: false,
      },
    });

    await postRecurringNowAction(row.id);

    const updated = await prisma.recurringTransaction.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.isActive).toBe(false);
  });
});

describe("runRecurringNowAction", () => {
  it("posts due entries and logs a summary audit entry", async () => {
    await prisma.recurringTransaction.create({
      data: {
        name: "Sofort fällig",
        amountCents: -500,
        accountId: fixtures.account.id,
        categoryId: fixtures.groceries.id,
        intervalMonths: 1,
        startDate: "2020-01-01",
        nextDate: "2020-01-01",
        autoPost: true,
      },
    });

    const result = await runRecurringNowAction();
    expect(result.success).toBe(true);
    expect(result.posted).toBeGreaterThan(0);

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "RecurringTransaction", details: { contains: "runNow" } },
    });
    expect(audit).toBeTruthy();
  });
});
