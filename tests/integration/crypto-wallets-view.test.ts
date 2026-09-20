import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestDb } from "./helpers";

// Pinned rate: the real one comes from CoinGecko, which a test must never call.
vi.mock("@/lib/crypto-price", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/crypto-price")>();
  return { ...actual, btcChfRate: vi.fn(async () => 100000) };
});

import { walletViews } from "@/lib/crypto-wallets";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const db = createTestDb();
  prisma = db.prisma;
  cleanup = db.cleanup;

  const wallet = await prisma.cryptoWallet.create({ data: { name: "Ledger", sortOrder: 0 } });
  await prisma.account.create({
    data: {
      name: "Anteil Michael",
      type: "Crypto",
      btcAmount: 0.75,
      btcCostBasisCents: 5000000,
      cryptoWalletId: wallet.id,
      sortOrder: 0,
    },
  });
  await prisma.account.create({
    data: {
      name: "Anteil Kind A",
      type: "Crypto",
      btcAmount: 0.25,
      btcCostBasisCents: 1000000,
      cryptoWalletId: wallet.id,
      excludeFromNetWorth: true,
      sortOrder: 1,
    },
  });
  // Standalone crypto account: must not show up in any wallet.
  await prisma.account.create({ data: { name: "Einzel", type: "Crypto", btcAmount: 1 } });
});

afterAll(async () => cleanup());

describe("walletViews", () => {
  it("totals the stakes and reports each one's share", async () => {
    const [wallet] = await walletViews(prisma);

    expect(wallet.name).toBe("Ledger");
    expect(wallet.totalBtc).toBeCloseTo(1, 8);
    expect(wallet.totalCostBasisCents).toBe(6000000);
    // 1 BTC at 100'000 CHF = 10'000'000 Rappen.
    expect(wallet.totalValueCents).toBe(10000000);

    expect(wallet.stakes).toHaveLength(2);
    expect(wallet.stakes[0].sharePct).toBeCloseTo(75, 6);
    expect(wallet.stakes[0].valueCents).toBe(7500000);
    expect(wallet.stakes[0].gainLossCents).toBe(2500000);
    expect(wallet.stakes[1].excludeFromNetWorth).toBe(true);
  });

  it("reports an empty wallet without dividing by zero", async () => {
    const empty = await prisma.cryptoWallet.create({ data: { name: "Leer", sortOrder: 1 } });
    await prisma.account.create({
      data: { name: "Anteil leer", type: "Crypto", cryptoWalletId: empty.id },
    });

    const views = await walletViews(prisma);
    const view = views.find((w) => w.id === empty.id)!;
    expect(view.totalBtc).toBe(0);
    expect(view.totalCostBasisCents).toBeNull();
    expect(view.stakes[0].sharePct).toBe(0);
    expect(view.stakes[0].gainLossCents).toBeNull();
  });
});
