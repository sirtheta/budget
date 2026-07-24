import type { Account, AccountType, PrismaClient } from "@prisma/client";
import { colorFor } from "@/lib/colors";

export interface AccountBalance {
  id: number;
  name: string;
  type: AccountType;
  color: string;
  excludeFromBudget: boolean;
  /** Opening balance plus every booked transaction, in Rappen. */
  balanceCents: number;
  openingBalanceCents: number;
}

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  Checking: "Privatkonto",
  Savings: "Sparkonto",
  CreditCard: "Kreditkarte",
  Cash: "Bargeld",
  Investment: "Depot",
};

/**
 * Current balance of every account: its opening balance plus the sum of all
 * its transactions.
 *
 * Balances are derived rather than stored — a stored running balance would
 * drift the moment a transaction is edited, deleted, or back-dated, and
 * back-dating is the normal case when importing a statement.
 */
export async function accountBalances(
  prisma: PrismaClient,
  options: { includeInactive?: boolean } = {}
): Promise<AccountBalance[]> {
  const accounts = await prisma.account.findMany({
    where: options.includeInactive ? {} : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  const sums = await prisma.transaction.groupBy({
    by: ["accountId"],
    _sum: { amountCents: true },
  });
  const byAccount = new Map(sums.map((row) => [row.accountId, row._sum.amountCents ?? 0]));

  return accounts.map((account) => ({
    id: account.id,
    name: account.name,
    type: account.type,
    color: colorFor(account.id, account.color),
    excludeFromBudget: account.excludeFromBudget,
    openingBalanceCents: account.openingBalanceCents,
    balanceCents: account.openingBalanceCents + (byAccount.get(account.id) ?? 0),
  }));
}

/** Balance of a single account, or null when the account doesn't exist. */
export async function accountBalance(
  prisma: PrismaClient,
  accountId: number
): Promise<number | null> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { openingBalanceCents: true },
  });
  if (!account) return null;
  const sum = await prisma.transaction.aggregate({
    where: { accountId },
    _sum: { amountCents: true },
  });
  return account.openingBalanceCents + (sum._sum.amountCents ?? 0);
}

/** Sum of all account balances — the household's net worth, in Rappen. */
export function netWorthCents(balances: AccountBalance[]): number {
  return balances.reduce((total, account) => total + account.balanceCents, 0);
}

/**
 * Balance of an account as it stood at the end of `date` (inclusive).
 * Used for the net-worth trend, which needs a balance per historical month.
 */
export async function balanceAsOf(
  prisma: PrismaClient,
  accountId: number,
  date: string
): Promise<number> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { openingBalanceCents: true },
  });
  if (!account) return 0;
  const sum = await prisma.transaction.aggregate({
    where: { accountId, date: { lte: date } },
    _sum: { amountCents: true },
  });
  return account.openingBalanceCents + (sum._sum.amountCents ?? 0);
}

/** Accounts that count towards budget evaluations (see Account.excludeFromBudget). */
export function budgetRelevant(accounts: Account[]): Account[] {
  return accounts.filter((account) => !account.excludeFromBudget);
}
