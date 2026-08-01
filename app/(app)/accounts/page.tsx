import prisma from "@/lib/prisma";
import { requireEditor } from "@/lib/permissions";
import {
  accountBalances,
  illiquidNetWorthCents,
  liquidNetWorthCents,
  netWorthCents,
} from "@/lib/balances";
import { categoryOptions } from "@/lib/categories";
import { todayInZone } from "@/lib/date";
import { config } from "@/lib/config";
import { formatMoney } from "@/lib/money";
import { PageHeader } from "@/components/page-header";
import { Money } from "@/components/money";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AccountFormDialog } from "./account-form-dialog";
import { AccountsList } from "./accounts-list";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  await requireEditor();

  const [accounts, balances, categories] = await Promise.all([
    prisma.account.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    accountBalances(prisma, { includeInactive: true }),
    categoryOptions(prisma),
  ]);
  const balanceById = Object.fromEntries(balances.map((b) => [b.id, b.balanceCents]));
  const btcById = Object.fromEntries(
    balances.map((b) => [
      b.id,
      {
        amount: b.btcAmount,
        rate: b.btcRateChf,
        costBasisCents: b.btcCostBasisCents,
        gainLossCents: b.btcGainLossCents,
      },
    ])
  );
  const sourceAccounts = accounts
    .filter((a) => a.isActive && a.type !== "Crypto")
    .map((a) => ({ id: a.id, name: a.name }));
  const today = todayInZone(config.recurring.timezone);
  // Taken from the balances rather than fetched again: `accountBalances` has
  // already resolved the rate, and asking a second time only risks a second
  // request against a rate-limited endpoint.
  const currentRateChf = balances.find((b) => b.btcRateChf !== null)?.btcRateChf ?? null;
  const activeBalances = balances.filter((b) => accounts.find((a) => a.id === b.id)?.isActive);
  const activeNetWorth = netWorthCents(activeBalances);
  const activeIlliquid = illiquidNetWorthCents(activeBalances);

  return (
    <>
      <PageHeader
        title="Konten"
        description="Alle Konten des Haushalts. Der Saldo ergibt sich aus dem Startsaldo plus allen Buchungen."
      >
        <AccountFormDialog />
      </PageHeader>

      <Card className="mb-6">
        <CardHeader>
          <CardDescription>Vermögen über alle aktiven Konten</CardDescription>
          <CardTitle className="text-3xl">
            <Money cents={activeNetWorth} withCurrency colored />
          </CardTitle>
        </CardHeader>
        {activeIlliquid !== 0 && (
          <CardContent className="pt-0">
            <p className="text-xs text-muted-foreground">
              Flüssig: {formatMoney(liquidNetWorthCents(activeBalances), { withCurrency: true })} ·
              nicht flüssig: {formatMoney(activeIlliquid, { withCurrency: true })}
            </p>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardContent className="p-0">
          {accounts.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Noch keine Konten erfasst. Lege zuerst dein Privatkonto an.
            </p>
          ) : (
            <AccountsList
              accounts={accounts}
              balanceById={balanceById}
              btcById={btcById}
              sourceAccounts={sourceAccounts}
              categories={categories}
              currentRateChf={currentRateChf}
              today={today}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}
