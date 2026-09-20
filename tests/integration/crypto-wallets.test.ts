import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestDb } from "./helpers";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const db = createTestDb();
  prisma = db.prisma;
  cleanup = db.cleanup;
});

afterAll(async () => cleanup());

describe("CryptoWallet schema", () => {
  it("groups crypto accounts and keeps them when the wallet is deleted", async () => {
    const wallet = await prisma.cryptoWallet.create({ data: { name: "Ledger" } });
    const stake = await prisma.account.create({
      data: { name: "Anteil Kind A", type: "Crypto", btcAmount: 0.25, cryptoWalletId: wallet.id },
    });

    const withStakes = await prisma.cryptoWallet.findUniqueOrThrow({
      where: { id: wallet.id },
      include: { accounts: true },
    });
    expect(withStakes.accounts.map((a) => a.id)).toEqual([stake.id]);

    await prisma.cryptoWallet.delete({ where: { id: wallet.id } });

    // onDelete: SetNull — deleting the grouping must never delete balances.
    const survivor = await prisma.account.findUniqueOrThrow({ where: { id: stake.id } });
    expect(survivor.cryptoWalletId).toBeNull();
    expect(survivor.btcAmount).toBe(0.25);
  });
});
