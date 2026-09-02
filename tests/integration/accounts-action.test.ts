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
  saveAccountAction,
  recordBtcPurchaseAction,
  toggleAccountActiveAction,
  deleteAccountAction,
} from "@/app/(app)/accounts/actions";

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

describe("saveAccountAction", () => {
  it("rejects an invalid Swiss IBAN", async () => {
    const result = await saveAccountAction(
      undefined,
      form({ name: "Konto", type: "Checking", iban: "DE1234", openingBalance: "0", btcAmount: "0", btcCostBasis: "" })
    );
    expect(result.error).toMatch(/IBAN/);
  });

  it("creates a checking account and logs an audit entry", async () => {
    const result = await saveAccountAction(
      undefined,
      form({
        name: "Neues Konto",
        type: "Checking",
        iban: "CH93 0076 2011 6238 5295 7",
        openingBalance: "1000",
        btcAmount: "0",
        btcCostBasis: "",
        excludeFromNetWorth: "on",
      })
    );
    expect(result).toEqual({ success: true });
    expect(revalidatePathMock).toHaveBeenCalledWith("/accounts");

    const row = await prisma.account.findFirstOrThrow({ where: { name: "Neues Konto" } });
    expect(row.iban).toBe("CH9300762011623852957");
    expect(row.openingBalanceCents).toBe(100000);
    expect(row.excludeFromNetWorth).toBe(true);
  });

  it("rejects a duplicate IBAN", async () => {
    const result = await saveAccountAction(
      undefined,
      form({
        name: "Zweites Konto",
        type: "Checking",
        iban: "CH93 0076 2011 6238 5295 7",
        openingBalance: "0",
        btcAmount: "0",
        btcCostBasis: "",
      })
    );
    expect(result.error).toBe("Diese IBAN ist bereits einem anderen Konto zugeordnet.");
  });

  it("creates a crypto account with a BTC balance and cost basis, ignoring any IBAN", async () => {
    const result = await saveAccountAction(
      undefined,
      form({
        name: "BTC Wallet",
        type: "Crypto",
        iban: "",
        openingBalance: "0",
        btcAmount: "0.5",
        btcCostBasis: "20000",
      })
    );
    expect(result).toEqual({ success: true });
    const row = await prisma.account.findFirstOrThrow({ where: { name: "BTC Wallet" } });
    expect(row.btcAmount).toBe(0.5);
    expect(row.btcCostBasisCents).toBe(2000000);
    expect(row.iban).toBeNull();
  });

  it("rejects a negative BTC balance", async () => {
    const result = await saveAccountAction(
      undefined,
      form({ name: "Bad Wallet", type: "Crypto", iban: "", openingBalance: "0", btcAmount: "-1", btcCostBasis: "" })
    );
    expect(result.error).toBe("BTC-Bestand ist keine gültige Zahl.");
  });

  it("updates an existing account", async () => {
    const account = await prisma.account.findFirstOrThrow({ where: { name: "Neues Konto" } });
    const result = await saveAccountAction(
      undefined,
      form({
        id: String(account.id),
        name: "Umbenanntes Konto",
        type: "Checking",
        iban: "",
        openingBalance: "1000",
        btcAmount: "0",
        btcCostBasis: "",
      })
    );
    expect(result).toEqual({ success: true });
    const updated = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(updated.name).toBe("Umbenanntes Konto");
  });
});

describe("recordBtcPurchaseAction", () => {
  it("requires both a source account and a wallet", async () => {
    const result = await recordBtcPurchaseAction(
      undefined,
      form({ date: "2026-07-01", description: "Kauf", chfAmount: "500", btcAmount: "0.01" })
    );
    expect(result.error).toBe("Bitte Quellkonto und Wallet auswählen.");
  });

  it("books a purchase, moving CHF out and BTC in", async () => {
    const wallet = await prisma.account.findFirstOrThrow({ where: { name: "BTC Wallet" } });
    const result = await recordBtcPurchaseAction(
      undefined,
      form({
        date: "2026-07-01",
        description: "Kauf via Kraken",
        sourceAccountId: String(fixtures.account.id),
        cryptoAccountId: String(wallet.id),
        chfAmount: "500",
        btcAmount: "0.01",
      })
    );
    expect(result).toEqual({ success: true });

    const updatedWallet = await prisma.account.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(updatedWallet.btcAmount).toBeCloseTo(0.51);

    // The CHF leg carries the wallet link and BTC quantity, not just the CHF
    // amount — deleting it later (see deleteTransactionAction) needs both to
    // reverse the wallet update.
    const chfLeg = await prisma.transaction.findFirstOrThrow({
      where: { description: "Kauf via Kraken" },
    });
    expect(chfLeg.btcWalletId).toBe(wallet.id);
    expect(chfLeg.btcQuantity).toBeCloseTo(0.01);

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "Transaction", details: { contains: "btcPurchase" } },
    });
    expect(audit).toBeTruthy();
  });

  it("rejects a non-positive CHF amount", async () => {
    const wallet = await prisma.account.findFirstOrThrow({ where: { name: "BTC Wallet" } });
    const result = await recordBtcPurchaseAction(
      undefined,
      form({
        date: "2026-07-01",
        description: "Kauf",
        sourceAccountId: String(fixtures.account.id),
        cryptoAccountId: String(wallet.id),
        chfAmount: "0",
        btcAmount: "0.01",
      })
    );
    expect(result.error).toBe("CHF-Betrag ist keine gültige Zahl.");
  });
});

describe("toggleAccountActiveAction / deleteAccountAction", () => {
  it("toggles active state and logs an audit entry", async () => {
    const account = await prisma.account.findFirstOrThrow({ where: { name: "Umbenanntes Konto" } });
    const result = await toggleAccountActiveAction(account.id, false);
    expect(result).toEqual({ success: true });
    const updated = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(updated.isActive).toBe(false);
  });

  it("refuses to delete an account with booked transactions", async () => {
    const result = await deleteAccountAction(fixtures.account.id);
    expect(result.error).toMatch(/kann nicht gelöscht werden/);
  });

  it("deletes an account with no transactions and logs an audit entry", async () => {
    const account = await prisma.account.findFirstOrThrow({ where: { name: "Umbenanntes Konto" } });
    const result = await deleteAccountAction(account.id);
    expect(result).toEqual({ success: true });
    await expect(prisma.account.findUniqueOrThrow({ where: { id: account.id } })).rejects.toBeTruthy();
  });
});
