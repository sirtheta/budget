import Link from "next/link";
import prisma from "@/lib/prisma";
import { requireEditor } from "@/lib/permissions";
import {
  ACCOUNT_TYPE_LABELS,
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
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AccountFormDialog } from "./account-form-dialog";
import { AccountRowActions } from "./account-row-actions";
import { BtcPurchaseDialog } from "./btc-purchase-dialog";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  await requireEditor();

  const [accounts, balances, categories] = await Promise.all([
    prisma.account.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    accountBalances(prisma, { includeInactive: true }),
    categoryOptions(prisma),
  ]);
  const balanceById = new Map(balances.map((b) => [b.id, b.balanceCents]));
  const btcById = new Map(
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
            <>
            <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Konto</TableHead>
                    <TableHead>Art</TableHead>
                    <TableHead>IBAN</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts.map((account) => (
                    <TableRow key={account.id} className={account.isActive ? "" : "opacity-55"}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span
                            className="size-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: account.color ?? "#6366f1" }}
                            aria-hidden
                          />
                          <Link
                            href={`/transactions?accountId=${account.id}`}
                            className="font-medium hover:underline"
                          >
                            {account.name}
                          </Link>
                          {!account.isActive && <Badge variant="outline">Inaktiv</Badge>}
                          {account.excludeFromBudget && (
                            <Badge variant="secondary">Ausserhalb Budget</Badge>
                          )}
                        </div>
                        {account.notes && (
                          <p className="text-xs text-muted-foreground mt-0.5">{account.notes}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {ACCOUNT_TYPE_LABELS[account.type]}
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">
                        {account.type === "Crypto"
                          ? (() => {
                              const btc = btcById.get(account.id);
                              if (!btc || btc.amount === null) return "—";
                              return `${btc.amount} BTC${btc.rate === null ? " (Kurs n/a)" : ` @ ${btc.rate.toLocaleString("de-CH")}`}`;
                            })()
                          : (account.iban ?? "—")}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        <Money cents={balanceById.get(account.id) ?? 0} colored />
                        {account.type === "Crypto" &&
                          (() => {
                            const btc = btcById.get(account.id);
                            if (!btc || btc.gainLossCents === null || !btc.costBasisCents) {
                              return null;
                            }
                            const pct = (btc.gainLossCents / btc.costBasisCents) * 100;
                            return (
                              <p className="text-xs font-normal">
                                <Money cents={btc.gainLossCents} colored forceSign /> (
                                {pct >= 0 ? "+" : ""}
                                {pct.toFixed(1)}%)
                              </p>
                            );
                          })()}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          {account.type === "Crypto" && sourceAccounts.length > 0 && (
                            <BtcPurchaseDialog
                              cryptoAccountId={account.id}
                              sourceAccounts={sourceAccounts}
                              categories={categories}
                              currentRateChf={currentRateChf}
                              today={today}
                            />
                          )}
                          <AccountRowActions account={account} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <ul className="md:hidden divide-y">
              {accounts.map((account) => {
                const btc = btcById.get(account.id);
                const gainLossPct =
                  account.type === "Crypto" && btc?.gainLossCents !== undefined && btc?.gainLossCents !== null && btc.costBasisCents
                    ? (btc.gainLossCents / btc.costBasisCents) * 100
                    : null;
                return (
                  <li key={account.id} className={`p-4 ${account.isActive ? "" : "opacity-55"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className="size-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: account.color ?? "#6366f1" }}
                            aria-hidden
                          />
                          <Link
                            href={`/transactions?accountId=${account.id}`}
                            className="font-medium hover:underline"
                          >
                            {account.name}
                          </Link>
                          {!account.isActive && <Badge variant="outline">Inaktiv</Badge>}
                          {account.excludeFromBudget && (
                            <Badge variant="secondary">Ausserhalb Budget</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {ACCOUNT_TYPE_LABELS[account.type]}
                          {account.type === "Crypto"
                            ? btc && btc.amount !== null
                              ? ` · ${btc.amount} BTC${btc.rate === null ? " (Kurs n/a)" : ` @ ${btc.rate.toLocaleString("de-CH")}`}`
                              : ""
                            : account.iban
                              ? ` · ${account.iban}`
                              : ""}
                        </p>
                        {account.notes && (
                          <p className="text-xs text-muted-foreground mt-0.5">{account.notes}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-medium">
                          <Money cents={balanceById.get(account.id) ?? 0} colored />
                        </p>
                        {gainLossPct !== null && btc && (
                          <p className="text-xs">
                            <Money cents={btc.gainLossCents!} colored forceSign /> (
                            {gainLossPct >= 0 ? "+" : ""}
                            {gainLossPct.toFixed(1)}%)
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex justify-end mt-2">
                      {account.type === "Crypto" && sourceAccounts.length > 0 && (
                        <BtcPurchaseDialog
                          cryptoAccountId={account.id}
                          sourceAccounts={sourceAccounts}
                          categories={categories}
                          currentRateChf={currentRateChf}
                          today={today}
                        />
                      )}
                      <AccountRowActions account={account} />
                    </div>
                  </li>
                );
              })}
            </ul>
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
