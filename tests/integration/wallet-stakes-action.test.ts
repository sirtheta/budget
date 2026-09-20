import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestDb } from "./helpers";

const { prismaHolder, sessionHolder, revalidatePathMock } = vi.hoisted(() => ({
  prismaHolder: { current: undefined as unknown },
  sessionHolder: {
    current: { user: { id: "1", role: "Editor", name: "Editor", email: "e@test.ch" } },
  },
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

import { updateWalletStakesAction } from "@/app/(app)/accounts/actions";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
let walletId: number;
let mine: number;
let kid: number;
let outsider: number;

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

beforeEach(async () => {
  await prisma.auditLog.deleteMany();
  await prisma.account.deleteMany();
  await prisma.cryptoWallet.deleteMany();

  const wallet = await prisma.cryptoWallet.create({ data: { name: "Ledger" } });
  walletId = wallet.id;
  mine = (
    await prisma.account.create({
      data: {
        name: "Anteil Michael",
        type: "Crypto",
        btcAmount: 0.2,
        btcCostBasisCents: 500000,
        cryptoWalletId: wallet.id,
      },
    })
  ).id;
  // btcAmount deliberately NULL: a stake that has never held BTC must not
  // break the COALESCE-based increment.
  kid = (
    await prisma.account.create({
      data: { name: "Anteil Kind A", type: "Crypto", cryptoWalletId: wallet.id },
    })
  ).id;
  outsider = (
    await prisma.account.create({ data: { name: "Fremdes Wallet", type: "Crypto" } })
  ).id;
});

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

describe("updateWalletStakesAction", () => {
  it("adds up several stakes in one submit and logs one audit entry", async () => {
    const result = await updateWalletStakesAction(
      undefined,
      form({
        walletId: String(walletId),
        [`btcDelta-${mine}`]: "0.05",
        [`costDelta-${mine}`]: "1000.00",
        [`btcDelta-${kid}`]: "0,01",
        [`costDelta-${kid}`]: "200",
      })
    );
    expect(result.success).toBe(true);

    const after = await prisma.account.findMany({
      where: { id: { in: [mine, kid] } },
      orderBy: { id: "asc" },
    });
    expect(after[0].btcAmount).toBeCloseTo(0.25, 8);
    expect(after[0].btcCostBasisCents).toBe(600000);
    expect(after[1].btcAmount).toBeCloseTo(0.01, 8);
    expect(after[1].btcCostBasisCents).toBe(20000);

    const audits = await prisma.auditLog.findMany({ where: { entityType: "CryptoWallet" } });
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe("UPDATE");
  });

  it("accepts a negative delta as a sale", async () => {
    const result = await updateWalletStakesAction(
      undefined,
      form({
        walletId: String(walletId),
        [`btcDelta-${mine}`]: "-0.05",
        [`costDelta-${mine}`]: "-100.00",
      })
    );
    expect(result.success).toBe(true);

    const after = await prisma.account.findUniqueOrThrow({ where: { id: mine } });
    expect(after.btcAmount).toBeCloseTo(0.15, 8);
    expect(after.btcCostBasisCents).toBe(490000);
  });

  it("rolls every row back when one would go negative", async () => {
    const result = await updateWalletStakesAction(
      undefined,
      form({
        walletId: String(walletId),
        [`btcDelta-${kid}`]: "0.01",
        [`btcDelta-${mine}`]: "-5",
      })
    );
    expect(result.error).toMatch(/negativ/i);

    const after = await prisma.account.findMany({
      where: { id: { in: [mine, kid] } },
      orderBy: { id: "asc" },
    });
    expect(after[0].btcAmount).toBeCloseTo(0.2, 8);
    expect(after[1].btcAmount).toBeNull();
  });

  it("ignores fields for accounts that belong to another wallet", async () => {
    const result = await updateWalletStakesAction(
      undefined,
      form({ walletId: String(walletId), [`btcDelta-${outsider}`]: "1" })
    );
    expect(result.error).toMatch(/keine Änderung/i);

    const after = await prisma.account.findUniqueOrThrow({ where: { id: outsider } });
    expect(after.btcAmount).toBeNull();
  });

  it("rejects a non-numeric BTC delta", async () => {
    const result = await updateWalletStakesAction(
      undefined,
      form({ walletId: String(walletId), [`btcDelta-${mine}`]: "viel" })
    );
    expect(result.error).toMatch(/BTC/);
  });
});
