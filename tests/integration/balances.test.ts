import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { accountBalance, accountBalances, balanceAsOf, netWorthCents } from "@/lib/balances";
import { createTransfer, deleteTransfer, recordBtcPurchase } from "@/lib/transactions";
import { createTestDb, seedBasics } from "./helpers";

// Deterministic rate so gain/loss assertions don't depend on the live
// CoinGecko response (or a network call in CI at all).
vi.mock("@/lib/crypto-price", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/crypto-price")>();
  return { ...actual, btcChfRate: vi.fn().mockResolvedValue(60000) };
});

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

describe("account balances", () => {
  it("starts at the opening balance", async () => {
    expect(await accountBalance(prisma, fixtures.account.id)).toBe(100000);
  });

  it("adds signed transactions to the opening balance", async () => {
    await prisma.transaction.createMany({
      data: [
        {
          date: "2026-01-05",
          amountCents: -8240,
          accountId: fixtures.account.id,
          categoryId: fixtures.groceries.id,
          description: "Migros",
        },
        {
          date: "2026-01-25",
          amountCents: 680000,
          accountId: fixtures.account.id,
          categoryId: fixtures.income.id,
          description: "Lohn",
        },
      ],
    });
    expect(await accountBalance(prisma, fixtures.account.id)).toBe(100000 - 8240 + 680000);
  });

  it("reports a balance as of a past date, ignoring later bookings", async () => {
    expect(await balanceAsOf(prisma, fixtures.account.id, "2026-01-10")).toBe(100000 - 8240);
  });

  it("returns null for an unknown account rather than 0", async () => {
    expect(await accountBalance(prisma, 99_999)).toBeNull();
  });
});

describe("transfers", () => {
  it("moves money without changing net worth", async () => {
    const before = netWorthCents(await accountBalances(prisma));

    await createTransfer(prisma, {
      fromAccountId: fixtures.account.id,
      toAccountId: fixtures.savings.id,
      date: "2026-01-26",
      amountCents: 70000,
      description: "Dauerauftrag Sparen",
    });

    const balances = await accountBalances(prisma);
    expect(netWorthCents(balances)).toBe(before);
    expect(balances.find((a) => a.id === fixtures.savings.id)?.balanceCents).toBe(570000);
  });

  it("writes exactly two linked legs with opposite signs and no category", async () => {
    const legs = await prisma.transaction.findMany({
      where: { transferGroupId: { not: null } },
      orderBy: { amountCents: "asc" },
    });
    expect(legs).toHaveLength(2);
    expect(legs[0].amountCents).toBe(-70000);
    expect(legs[1].amountCents).toBe(70000);
    expect(legs[0].transferGroupId).toBe(legs[1].transferGroupId);
    expect(legs.every((leg) => leg.categoryId === null)).toBe(true);
  });

  it("normalises a negative input to a magnitude", async () => {
    const [outgoing] = await createTransfer(prisma, {
      fromAccountId: fixtures.account.id,
      toAccountId: fixtures.savings.id,
      date: "2026-02-26",
      amountCents: -5000,
      description: "Sparen",
    });
    expect(outgoing.amountCents).toBe(-5000);
    await deleteTransfer(prisma, outgoing.transferGroupId!);
  });

  it("refuses a transfer to the same account", async () => {
    await expect(
      createTransfer(prisma, {
        fromAccountId: fixtures.account.id,
        toAccountId: fixtures.account.id,
        date: "2026-01-26",
        amountCents: 100,
        description: "Unsinn",
      })
    ).rejects.toThrow(/unterschiedlich/);
  });

  it("refuses a zero-amount transfer", async () => {
    await expect(
      createTransfer(prisma, {
        fromAccountId: fixtures.account.id,
        toAccountId: fixtures.savings.id,
        date: "2026-01-26",
        amountCents: 0,
        description: "Nichts",
      })
    ).rejects.toThrow(/nicht 0/);
  });

  it("deletes both legs together", async () => {
    const [outgoing] = await createTransfer(prisma, {
      fromAccountId: fixtures.account.id,
      toAccountId: fixtures.savings.id,
      date: "2026-03-01",
      amountCents: 12345,
      description: "Test",
    });
    const removed = await deleteTransfer(prisma, outgoing.transferGroupId!);
    expect(removed).toBe(2);
  });
});

describe("bitcoin purchases", () => {
  it("books the CHF leg as an outflow and adds the BTC to the wallet", async () => {
    const wallet = await prisma.account.create({ data: { name: "Kraken", type: "Crypto" } });

    const tx = await recordBtcPurchase(prisma, {
      sourceAccountId: fixtures.account.id,
      cryptoAccountId: wallet.id,
      date: "2026-01-06",
      chfAmountCents: 5000,
      btcAmount: 0.00050123,
      categoryId: fixtures.groceries.id,
      description: "Bitcoin-Kauf",
    });

    expect(tx.amountCents).toBe(-5000);
    expect(tx.accountId).toBe(fixtures.account.id);

    const updated = await prisma.account.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(updated.btcAmount).toBeCloseTo(0.00050123, 8);
    expect(updated.btcCostBasisCents).toBe(5000);
  });

  it("accumulates across repeated purchases rather than overwriting", async () => {
    const wallet = await prisma.account.create({ data: { name: "Pocket", type: "Crypto" } });

    await recordBtcPurchase(prisma, {
      sourceAccountId: fixtures.account.id,
      cryptoAccountId: wallet.id,
      date: "2026-01-06",
      chfAmountCents: 5000,
      btcAmount: 0.0001,
      description: "Woche 1",
    });
    await recordBtcPurchase(prisma, {
      sourceAccountId: fixtures.account.id,
      cryptoAccountId: wallet.id,
      date: "2026-01-13",
      chfAmountCents: 5000,
      btcAmount: 0.0002,
      description: "Woche 2",
    });

    const updated = await prisma.account.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(updated.btcAmount).toBeCloseTo(0.0003, 8);
    expect(updated.btcCostBasisCents).toBe(10000);
  });

  it("reports gain/loss against the live rate once a purchase is recorded", async () => {
    const wallet = await prisma.account.create({ data: { name: "Ledger", type: "Crypto" } });

    await recordBtcPurchase(prisma, {
      sourceAccountId: fixtures.account.id,
      cryptoAccountId: wallet.id,
      date: "2026-01-06",
      chfAmountCents: 5000, // 50 CHF paid
      btcAmount: 0.001,
      description: "Kauf",
    });

    // Mocked rate is 60'000 CHF/BTC, so 0.001 BTC is worth 60 CHF now.
    const balances = await accountBalances(prisma);
    const balance = balances.find((b) => b.id === wallet.id)!;
    expect(balance.btcCostBasisCents).toBe(5000);
    expect(balance.balanceCents).toBe(6000);
    expect(balance.btcGainLossCents).toBe(1000);
  });

  it("hides gain/loss for a wallet with no recorded cost basis", async () => {
    const wallet = await prisma.account.create({
      data: { name: "Altbestand", type: "Crypto", btcAmount: 0.01 },
    });

    const balances = await accountBalances(prisma);
    const balance = balances.find((b) => b.id === wallet.id)!;
    expect(balance.btcCostBasisCents).toBeNull();
    expect(balance.btcGainLossCents).toBeNull();
  });

  it("refuses a non-positive CHF amount", async () => {
    const wallet = await prisma.account.create({ data: { name: "W1", type: "Crypto" } });
    await expect(
      recordBtcPurchase(prisma, {
        sourceAccountId: fixtures.account.id,
        cryptoAccountId: wallet.id,
        date: "2026-01-06",
        chfAmountCents: 0,
        btcAmount: 0.0001,
        description: "Ungültig",
      })
    ).rejects.toThrow(/CHF-Betrag/);
  });

  it("refuses a non-positive BTC amount", async () => {
    const wallet = await prisma.account.create({ data: { name: "W2", type: "Crypto" } });
    await expect(
      recordBtcPurchase(prisma, {
        sourceAccountId: fixtures.account.id,
        cryptoAccountId: wallet.id,
        date: "2026-01-06",
        chfAmountCents: 5000,
        btcAmount: 0,
        description: "Ungültig",
      })
    ).rejects.toThrow(/BTC-Menge/);
  });

  it("refuses a target account that isn't a Crypto wallet", async () => {
    await expect(
      recordBtcPurchase(prisma, {
        sourceAccountId: fixtures.account.id,
        cryptoAccountId: fixtures.savings.id,
        date: "2026-01-06",
        chfAmountCents: 5000,
        btcAmount: 0.0001,
        description: "Ungültig",
      })
    ).rejects.toThrow(/Wallet/);
  });

  it("refuses a source account that is itself a Crypto wallet", async () => {
    const walletA = await prisma.account.create({ data: { name: "W3", type: "Crypto" } });
    const walletB = await prisma.account.create({ data: { name: "W4", type: "Crypto" } });
    await expect(
      recordBtcPurchase(prisma, {
        sourceAccountId: walletA.id,
        cryptoAccountId: walletB.id,
        date: "2026-01-06",
        chfAmountCents: 5000,
        btcAmount: 0.0001,
        description: "Ungültig",
      })
    ).rejects.toThrow(/Quellkonto/);
  });
});
