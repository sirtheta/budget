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
  saveReserveAction,
  addToReserveAction,
  settleReserveAction,
  deleteReserveAction,
  saveGoalAction,
  addToGoalAction,
  deleteGoalAction,
} from "@/app/(app)/reserves/actions";

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

describe("saveReserveAction", () => {
  it("rejects a target amount that isn't positive", async () => {
    const result = await saveReserveAction(
      undefined,
      form({ name: "Steuern", intervalMonths: "12", nextDueDate: "2027-03-31", targetAmount: "0" })
    );
    expect(result.error).toBe("Der Betrag muss grösser als 0 sein.");
  });

  it("rejects a negative saved amount", async () => {
    const result = await saveReserveAction(
      undefined,
      form({
        name: "Steuern",
        intervalMonths: "12",
        nextDueDate: "2027-03-31",
        targetAmount: "3000",
        saved: "-10",
      })
    );
    expect(result.error).toBe("Der zurückgelegte Betrag kann nicht negativ sein.");
  });

  it("creates a reserve and logs an audit entry", async () => {
    const result = await saveReserveAction(
      undefined,
      form({
        name: "Steuern",
        intervalMonths: "12",
        nextDueDate: "2027-03-31",
        targetAmount: "3000",
        categoryId: String(fixtures.groceries.id),
        accountId: String(fixtures.account.id),
      })
    );
    expect(result).toEqual({ success: true });
    expect(revalidatePathMock).toHaveBeenCalledWith("/reserves");
    const row = await prisma.reserve.findFirstOrThrow({ where: { name: "Steuern" } });
    expect(row.targetAmountCents).toBe(300000);
  });

  it("updates an existing reserve", async () => {
    const row = await prisma.reserve.findFirstOrThrow({ where: { name: "Steuern" } });
    const result = await saveReserveAction(
      undefined,
      form({
        id: String(row.id),
        name: "Steuern (aktualisiert)",
        intervalMonths: "12",
        nextDueDate: "2027-03-31",
        targetAmount: "3200",
      })
    );
    expect(result).toEqual({ success: true });
    const updated = await prisma.reserve.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.name).toBe("Steuern (aktualisiert)");
  });
});

describe("addToReserveAction", () => {
  it("returns an error for an unknown reserve", async () => {
    const result = await addToReserveAction(999999, "100");
    expect(result.error).toBe("Rückstellung nicht gefunden.");
  });

  it("adds to the saved amount", async () => {
    const row = await prisma.reserve.findFirstOrThrow({ where: { name: "Steuern (aktualisiert)" } });
    const result = await addToReserveAction(row.id, "500");
    expect(result).toEqual({ success: true });
    const updated = await prisma.reserve.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.savedCents).toBe(row.savedCents + 50000);
  });

  it("never lets the saved amount go below zero", async () => {
    const row = await prisma.reserve.findFirstOrThrow({ where: { name: "Steuern (aktualisiert)" } });
    const result = await addToReserveAction(row.id, `-${row.savedCents / 100 + 1000}`);
    expect(result).toEqual({ success: true });
    const updated = await prisma.reserve.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.savedCents).toBe(0);
  });
});

describe("settleReserveAction / deleteReserveAction", () => {
  it("returns an error for an unknown reserve", async () => {
    const result = await settleReserveAction(999999);
    expect(result.error).toBe("Rückstellung nicht gefunden.");
  });

  it("settles a reserve, advancing its due date", async () => {
    const row = await prisma.reserve.findFirstOrThrow({ where: { name: "Steuern (aktualisiert)" } });
    const before = row.nextDueDate;
    const result = await settleReserveAction(row.id);
    expect(result).toEqual({ success: true });
    const updated = await prisma.reserve.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.nextDueDate).not.toBe(before);
  });

  it("deletes a reserve and logs an audit entry", async () => {
    const row = await prisma.reserve.findFirstOrThrow({ where: { name: "Steuern (aktualisiert)" } });
    const result = await deleteReserveAction(row.id);
    expect(result).toEqual({ success: true });
    await expect(prisma.reserve.findUniqueOrThrow({ where: { id: row.id } })).rejects.toBeTruthy();
  });
});

describe("saveGoalAction", () => {
  it("rejects a target amount that isn't positive", async () => {
    const result = await saveGoalAction(undefined, form({ name: "Ferien", targetAmount: "0" }));
    expect(result.error).toBe("Der Zielbetrag muss grösser als 0 sein.");
  });

  it("creates a savings goal and logs an audit entry", async () => {
    const result = await saveGoalAction(
      undefined,
      form({ name: "Ferien", targetAmount: "5000", targetDate: "2027-06-01" })
    );
    expect(result).toEqual({ success: true });
    const row = await prisma.savingsGoal.findFirstOrThrow({ where: { name: "Ferien" } });
    expect(row.targetAmountCents).toBe(500000);
  });
});

describe("addToGoalAction / deleteGoalAction", () => {
  it("returns an error for an unknown goal", async () => {
    const result = await addToGoalAction(999999, "100");
    expect(result.error).toBe("Sparziel nicht gefunden.");
  });

  it("adds to a goal's saved amount", async () => {
    const goal = await prisma.savingsGoal.findFirstOrThrow({ where: { name: "Ferien" } });
    const result = await addToGoalAction(goal.id, "200");
    expect(result).toEqual({ success: true });
    const updated = await prisma.savingsGoal.findUniqueOrThrow({ where: { id: goal.id } });
    expect(updated.savedCents).toBe(20000);
  });

  it("deletes a savings goal and logs an audit entry", async () => {
    const goal = await prisma.savingsGoal.findFirstOrThrow({ where: { name: "Ferien" } });
    const result = await deleteGoalAction(goal.id);
    expect(result).toEqual({ success: true });
    await expect(prisma.savingsGoal.findUniqueOrThrow({ where: { id: goal.id } })).rejects.toBeTruthy();
  });
});
