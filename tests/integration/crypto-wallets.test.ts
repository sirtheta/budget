import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestDb, seedBasics } from "./helpers";

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

import { saveCryptoWalletAction, deleteCryptoWalletAction } from "@/app/(app)/accounts/actions";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const db = createTestDb();
  prisma = db.prisma;
  cleanup = db.cleanup;
  prismaHolder.current = prisma;
  await seedBasics(prisma);
  const editor = await prisma.user.create({
    data: { email: "e@test.ch", name: "Editor", passwordHash: "x", role: "Editor" },
  });
  sessionHolder.current = {
    user: { id: String(editor.id), role: "Editor", name: "Editor", email: "e@test.ch" },
  };
});

afterAll(async () => cleanup());

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

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

describe("saveCryptoWalletAction", () => {
  it("creates a wallet and logs an audit entry", async () => {
    const result = await saveCryptoWalletAction(undefined, form({ name: "Bitcoin", notes: "" }));
    expect(result.success).toBe(true);

    const wallet = await prisma.cryptoWallet.findFirstOrThrow({ where: { name: "Bitcoin" } });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "CryptoWallet", entityId: wallet.id },
    });
    expect(audit.action).toBe("CREATE");
  });

  it("rejects an empty name", async () => {
    const result = await saveCryptoWalletAction(undefined, form({ name: "  ", notes: "" }));
    expect(result.error).toMatch(/Name/);
  });

  it("renames an existing wallet", async () => {
    const wallet = await prisma.cryptoWallet.create({ data: { name: "Alt" } });
    const result = await saveCryptoWalletAction(
      undefined,
      form({ id: String(wallet.id), name: "Neu", notes: "Hardware" })
    );
    expect(result.success).toBe(true);

    const after = await prisma.cryptoWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(after.name).toBe("Neu");
    expect(after.notes).toBe("Hardware");
  });

  it("returns a clean error when renaming a wallet that no longer exists", async () => {
    const result = await saveCryptoWalletAction(
      undefined,
      form({ id: "999999", name: "Geist", notes: "" })
    );
    expect(result.error).toBe("Wallet nicht gefunden.");
  });
});

describe("deleteCryptoWalletAction", () => {
  it("deletes the wallet but keeps its accounts and their balances", async () => {
    const wallet = await prisma.cryptoWallet.create({ data: { name: "Weg" } });
    const stake = await prisma.account.create({
      data: { name: "Anteil X", type: "Crypto", btcAmount: 0.5, cryptoWalletId: wallet.id },
    });

    const result = await deleteCryptoWalletAction(wallet.id);
    expect(result.success).toBe(true);

    const survivor = await prisma.account.findUniqueOrThrow({ where: { id: stake.id } });
    expect(survivor.cryptoWalletId).toBeNull();
    expect(survivor.btcAmount).toBe(0.5);
  });
});
