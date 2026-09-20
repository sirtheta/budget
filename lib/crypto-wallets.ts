import type { PrismaClient } from "@prisma/client";
import { btcChfRate, btcToCents } from "@/lib/crypto-price";

/** One person's stake in a physical wallet, valued at the current rate. */
export interface WalletStakeView {
  accountId: number;
  name: string;
  btcAmount: number;
  costBasisCents: number | null;
  valueCents: number;
  gainLossCents: number | null;
  /** Share of the wallet's BTC in percent; 0 while the wallet is empty. */
  sharePct: number;
  isActive: boolean;
  excludeFromNetWorth: boolean;
}

export interface WalletView {
  id: number;
  name: string;
  notes: string | null;
  totalBtc: number;
  /** Null while no stake has a cost basis — showing 0 would fake a 100% gain. */
  totalCostBasisCents: number | null;
  totalValueCents: number;
  rateChf: number | null;
  stakes: WalletStakeView[];
}

/**
 * The wallets with their stakes, valued at the live BTC rate. A read model for
 * the accounts page: the authoritative numbers stay on the accounts
 * themselves, so nothing here is ever written back.
 */
export async function walletViews(client: PrismaClient): Promise<WalletView[]> {
  const wallets = await client.cryptoWallet.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { accounts: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } },
  });
  if (wallets.length === 0) return [];

  // One rate for every wallet: the module caches, but asking once keeps a cold
  // cache from turning into several requests against a rate-limited API.
  const rate = await btcChfRate();

  return wallets.map((wallet) => {
    const totalBtc = wallet.accounts.reduce((sum, account) => sum + (account.btcAmount ?? 0), 0);
    const costBases = wallet.accounts
      .map((account) => account.btcCostBasisCents)
      .filter((cents): cents is number => cents !== null);

    const stakes: WalletStakeView[] = wallet.accounts.map((account) => {
      const btcAmount = account.btcAmount ?? 0;
      const valueCents = btcToCents(btcAmount, rate) ?? 0;
      const costBasisCents = account.btcCostBasisCents;
      return {
        accountId: account.id,
        name: account.name,
        btcAmount,
        costBasisCents,
        valueCents,
        gainLossCents:
          costBasisCents !== null && rate !== null ? valueCents - costBasisCents : null,
        sharePct: totalBtc === 0 ? 0 : (btcAmount / totalBtc) * 100,
        isActive: account.isActive,
        excludeFromNetWorth: account.excludeFromNetWorth,
      };
    });

    return {
      id: wallet.id,
      name: wallet.name,
      notes: wallet.notes,
      totalBtc,
      totalCostBasisCents: costBases.length === 0 ? null : costBases.reduce((a, b) => a + b, 0),
      totalValueCents: btcToCents(totalBtc, rate) ?? 0,
      rateChf: rate,
      stakes,
    };
  });
}
