import prisma from "@/lib/prisma";
import { requireEditor } from "@/lib/permissions";
import { ACCOUNT_TYPE_LABELS, accountBalances, netWorthCents } from "@/lib/balances";
import { categoryOptions } from "@/lib/categories";
import { todayInZone } from "@/lib/date";
import { config } from "@/lib/config";
import { btcChfRate } from "@/lib/crypto-price";
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
  const currentRateChf = accounts.some((a) => a.type === "Crypto") ? await btcChfRate() : null;
  const activeNetWorth = netWorthCents(balances.filter((b) => accounts.find((a) => a.id === b.id)?.isActive));

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
      </Card>

      <Card>
        <CardContent className="p-0">
          {accounts.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Noch keine Konten erfasst. Lege zuerst dein Privatkonto an.
            </p>
          ) : (
            <div className="overflow-x-auto">
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
                          <span className="font-medium">{account.name}</span>
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
          )}
        </CardContent>
      </Card>
    </>
  );
}
