import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  adoptTransferLeg,
  applyAutoTransfer,
  findAdoptableTransferLeg,
} from "@/lib/transactions";
import { createTestDb, seedBasics } from "./helpers";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
let fixtures: Awaited<ReturnType<typeof seedBasics>>;

beforeAll(async () => {
  const db = createTestDb();
  prisma = db.prisma;
  cleanup = db.cleanup;
  fixtures = await seedBasics(prisma);
});

afterAll(async () => cleanup());

describe("applyAutoTransfer", () => {
  it("creates a synthetic counterpart leg when the target account has nothing matching", async () => {
    const trigger = await prisma.transaction.create({
      data: {
        date: "2026-01-10",
        amountCents: -20000,
        accountId: fixtures.account.id,
        description: "Zahlung an Revolut",
        counterparty: "Revolut",
        source: "Import",
      },
    });

    await applyAutoTransfer(prisma, {
      transactionId: trigger.id,
      targetAccountId: fixtures.savings.id,
    });

    const legs = await prisma.transaction.findMany({ where: { transferGroupId: { not: null } } });
    expect(legs).toHaveLength(2);
    const counterpart = legs.find((leg) => leg.id !== trigger.id)!;
    expect(counterpart.accountId).toBe(fixtures.savings.id);
    expect(counterpart.amountCents).toBe(20000);
    expect(counterpart.categoryId).toBeNull();
    expect(counterpart.importHash).toBeNull();
    expect(counterpart.source).toBe("Manual");

    const refreshedTrigger = await prisma.transaction.findUniqueOrThrow({
      where: { id: trigger.id },
    });
    expect(refreshedTrigger.transferGroupId).toBe(counterpart.transferGroupId);
    expect(refreshedTrigger.categoryId).toBeNull();
  });

  it("links to an already-imported plain transaction instead of duplicating it", async () => {
    const existingOnTarget = await prisma.transaction.create({
      data: {
        date: "2026-01-22",
        amountCents: 15000,
        accountId: fixtures.savings.id,
        description: "Gutschrift",
        categoryId: fixtures.income.id,
        source: "Import",
      },
    });
    const trigger = await prisma.transaction.create({
      data: {
        date: "2026-01-20",
        amountCents: -15000,
        accountId: fixtures.account.id,
        description: "Zahlung an Kreditkarte",
        categoryId: fixtures.groceries.id,
        source: "Import",
      },
    });

    const before = await prisma.transaction.count();
    await applyAutoTransfer(prisma, {
      transactionId: trigger.id,
      targetAccountId: fixtures.savings.id,
    });
    const after = await prisma.transaction.count();
    expect(after).toBe(before); // linked, not duplicated

    const [refreshedTrigger, refreshedTarget] = await Promise.all([
      prisma.transaction.findUniqueOrThrow({ where: { id: trigger.id } }),
      prisma.transaction.findUniqueOrThrow({ where: { id: existingOnTarget.id } }),
    ]);
    expect(refreshedTrigger.transferGroupId).toBe(refreshedTarget.transferGroupId);
    expect(refreshedTrigger.categoryId).toBeNull();
    expect(refreshedTarget.categoryId).toBeNull();
  });

  it("does nothing to a row that is already a transfer leg", async () => {
    const trigger = await prisma.transaction.create({
      data: {
        date: "2026-01-10",
        amountCents: -500,
        accountId: fixtures.account.id,
        description: "Schon Umbuchung",
        source: "Manual",
      },
    });
    await applyAutoTransfer(prisma, {
      transactionId: trigger.id,
      targetAccountId: fixtures.savings.id,
    });
    const groupId = (await prisma.transaction.findUniqueOrThrow({ where: { id: trigger.id } }))
      .transferGroupId;

    await applyAutoTransfer(prisma, {
      transactionId: trigger.id,
      targetAccountId: fixtures.savings.id,
    });
    const unchanged = await prisma.transaction.findUniqueOrThrow({ where: { id: trigger.id } });
    expect(unchanged.transferGroupId).toBe(groupId);
  });

  it("refuses a transfer to the same account", async () => {
    const trigger = await prisma.transaction.create({
      data: {
        date: "2026-01-10",
        amountCents: -500,
        accountId: fixtures.account.id,
        description: "Unsinn",
        source: "Manual",
      },
    });
    await expect(
      applyAutoTransfer(prisma, { transactionId: trigger.id, targetAccountId: fixtures.account.id })
    ).rejects.toThrow(/unterschiedlich/);
  });
});

describe("findAdoptableTransferLeg / adoptTransferLeg", () => {
  it("finds a synthetic leg within the date tolerance and adopts real bank data into it", async () => {
    const trigger = await prisma.transaction.create({
      data: {
        date: "2026-02-01",
        amountCents: -30000,
        accountId: fixtures.account.id,
        description: "Zahlung an Revolut",
        source: "Import",
      },
    });
    await applyAutoTransfer(prisma, {
      transactionId: trigger.id,
      targetAccountId: fixtures.savings.id,
    });

    // The synthetic leg posted same-day; the "real" Revolut statement later
    // shows it clearing two days after.
    const realDate = "2026-02-03";
    const found = await findAdoptableTransferLeg(prisma, fixtures.savings.id, 30000, realDate);
    expect(found).not.toBeNull();

    const before = await prisma.transaction.count();
    await adoptTransferLeg(prisma, found!.id, {
      date: realDate,
      description: "Gutschrift Revolut",
      counterparty: "Max Muster",
      bankReference: "REF-123",
      importHash: "test-hash-adopt-1",
      importBatchId: (await prisma.importBatch.create({
        data: { filename: "revolut.csv", format: "Csv", accountId: fixtures.savings.id },
      })).id,
    });
    const after = await prisma.transaction.count();
    expect(after).toBe(before); // adopted in place, no new row

    const adopted = await prisma.transaction.findUniqueOrThrow({ where: { id: found!.id } });
    expect(adopted.importHash).toBe("test-hash-adopt-1");
    expect(adopted.bankReference).toBe("REF-123");
    expect(adopted.source).toBe("Import");
    expect(adopted.transferGroupId).toBe(
      (await prisma.transaction.findUniqueOrThrow({ where: { id: trigger.id } })).transferGroupId
    );
  });

  it("does not match a synthetic leg outside the tolerance window or with a different amount", async () => {
    const trigger = await prisma.transaction.create({
      data: {
        date: "2026-03-01",
        amountCents: -4000,
        accountId: fixtures.account.id,
        description: "Zahlung an Revolut",
        source: "Import",
      },
    });
    await applyAutoTransfer(prisma, {
      transactionId: trigger.id,
      targetAccountId: fixtures.savings.id,
    });

    expect(await findAdoptableTransferLeg(prisma, fixtures.savings.id, 4000, "2026-03-20")).toBeNull();
    expect(await findAdoptableTransferLeg(prisma, fixtures.savings.id, 4001, "2026-03-01")).toBeNull();
  });
});
