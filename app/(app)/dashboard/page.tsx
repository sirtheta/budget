import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarClock } from "lucide-react";
import prisma from "@/lib/prisma";
import { hasRole, requireSession } from "@/lib/permissions";
import { config } from "@/lib/config";
import {
  formatDateCH,
  monthEnd,
  monthName,
  monthStart,
  todayInZone,
  trailingMonths,
} from "@/lib/date";
import { accountBalances, illiquidNetWorthCents, liquidNetWorthCents, netWorthCents } from "@/lib/balances";
import { loadBudgetMonth } from "@/lib/budget";
import { categoryBreakdown, monthlySeries } from "@/lib/analytics";
import { totalMonthlyReserveCents } from "@/lib/reserves";
import { pendingSuggestions } from "@/lib/recurring";
import { categoryOptions } from "@/lib/categories";
import { formatMoney } from "@/lib/money";
import { btcChfHistory, btcToCents } from "@/lib/crypto-price";
import { PageHeader } from "@/components/page-header";
import { MonthNav } from "@/components/month-nav";
import { Money } from "@/components/money";
import { MonthlyBarChart } from "@/components/charts/monthly-bar-chart";
import { CategoryPieChart } from "@/components/charts/category-pie-chart";
import { BtcPriceChart } from "@/components/charts/btc-price-chart";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TransactionFormDialog } from "@/app/(app)/transactions/transaction-form-dialog";
import { PostSuggestionButton } from "./post-suggestion-button";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireSession();
  const canEdit = hasRole(session, ["Admin", "Editor"]);

  const raw = await searchParams;
  const today = todayInZone(config.recurring.timezone);
  const [currentYear, currentMonth] = today.split("-").map(Number);

  const year = parseInt(String(raw.year ?? currentYear), 10) || currentYear;
  const month = Math.min(12, Math.max(1, parseInt(String(raw.month ?? currentMonth), 10) || currentMonth));
  const isCurrentMonth = year === currentYear && month === currentMonth;

  const monthFrom = monthStart(year, month);
  const monthTo = isCurrentMonth ? today : monthEnd(year, month);

  const [
    balances,
    budget,
    series,
    breakdown,
    recentTransactions,
    reserves,
    recurring,
    accounts,
    categories,
  ] = await Promise.all([
    accountBalances(prisma),
    loadBudgetMonth(prisma, year, month),
    monthlySeries(prisma, trailingMonths(year, month, 12)),
    categoryBreakdown(prisma, monthFrom, monthTo, "Expense"),
    prisma.transaction.findMany({
      where: { date: { gte: monthFrom, lte: monthTo } },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      take: 8,
      include: {
        account: { select: { name: true } },
        category: { select: { name: true } },
      },
    }),
    prisma.reserve.findMany({ where: { isActive: true } }),
    prisma.recurringTransaction.findMany({ where: { isActive: true } }),
    prisma.account.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    categoryOptions(prisma),
  ]);

  const suggestions = isCurrentMonth ? pendingSuggestions(recurring, today) : [];
  const reserveMonthly = totalMonthlyReserveCents(reserves, today);
  const overBudget = budget.groups
    .flatMap((group) => group.lines)
    .filter((line) => line.status === "over" || line.status === "warning")
    .sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0));

  if (accounts.length === 0) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <Card>
          <CardContent className="py-12 text-center">
            <h2 className="font-medium mb-2">Willkommen</h2>
            <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
              Drei Schritte bis zur ersten Auswertung: Konto anlegen, Standardkategorien
              erzeugen, Buchungen erfassen oder einen Kontoauszug importieren.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild>
                <Link href="/accounts">Konto anlegen</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/categories">Kategorien einrichten</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </>
    );
  }

  const hasCrypto = balances.some((account) => account.type === "Crypto");
  // Reuse the rate accountBalances() already resolved instead of a second,
  // rate-limited CoinGecko hit for the "current price" tile (see accounts/page.tsx).
  const currentBtcRateChf = balances.find((account) => account.btcRateChf !== null)?.btcRateChf ?? null;
  const btcHistory = hasCrypto
    ? await Promise.all([btcChfHistory(7), btcChfHistory(30), btcChfHistory(365)])
    : null;

  return (
    <>
      <PageHeader title="Dashboard" description={`${monthName(month)} ${year}`}>
        <MonthNav year={year} month={month} basePath="/dashboard" />
        {canEdit && (
          <TransactionFormDialog accounts={accounts} categories={categories} today={today} />
        )}
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <Tile
          label="Vermögen"
          cents={netWorthCents(balances)}
          colored
          hint={
            illiquidNetWorthCents(balances) !== 0
              ? `Flüssig: ${formatMoney(liquidNetWorthCents(balances), {
                  withCurrency: true,
                })} · nicht flüssig: ${formatMoney(illiquidNetWorthCents(balances), {
                  withCurrency: true,
                })}`
              : undefined
          }
        />
        <Tile label="Einnahmen (Monat)" cents={budget.totals.actualIncomeCents} />
        <Tile label="Ausgaben (Monat)" cents={budget.totals.actualExpenseCents} />
        <Tile
          label="Saldo (Monat)"
          cents={budget.totals.actualBalanceCents}
          colored
          hint={
            reserveMonthly > 0
              ? `Nach Rückstellungen: ${formatMoney(
                  budget.totals.actualBalanceCents - reserveMonthly,
                  { withCurrency: true }
                )}`
              : undefined
          }
        />
      </div>

      {suggestions.length > 0 && canEdit && (
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarClock className="h-4 w-4" />
              Fällige wiederkehrende Buchungen
            </CardTitle>
            <CardDescription>
              Diese sind zur Bestätigung vorgemerkt und werden nicht automatisch gebucht.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {suggestions.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{row.name}</p>
                    <p className="text-xs text-muted-foreground">
                      fällig seit {formatDateCH(row.nextDate)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <Money cents={row.amountCents} colored />
                    <PostSuggestionButton id={row.id} />
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {budget.totals.uncategorizedCount > 0 && (
        <Card className="mb-6 border-amber-500/50">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
            <p className="text-sm flex-1">
              {budget.totals.uncategorizedCount} Buchung(en) diesen Monat ohne Kategorie
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/transactions?categoryId=none&from=${monthFrom}&to=${monthTo}`}>
                Zuordnen <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3 mb-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Einnahmen und Ausgaben</CardTitle>
            <CardDescription>Die letzten 12 Monate</CardDescription>
          </CardHeader>
          <CardContent>
            <MonthlyBarChart data={series} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Konten</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {balances.map((account) => (
                <li key={account.id} className="flex items-center gap-2 text-sm">
                  <span
                    className="size-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: account.color }}
                    aria-hidden
                  />
                  <span className="truncate">{account.name}</span>
                  <span className="ml-auto shrink-0 font-medium">
                    <Money cents={account.balanceCents} colored />
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ausgaben nach Kategorie</CardTitle>
            <CardDescription>
              {monthName(month)} {year} — Slice anklicken für die Buchungen
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CategoryPieChart slices={breakdown} from={monthFrom} to={monthTo} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Budget im Blick</CardTitle>
              <CardDescription>Kategorien nahe an oder über dem Budget</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/budget">
                Alle <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {overBudget.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Alles im Rahmen.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {overBudget.slice(0, 6).map((line) => (
                  <li key={line.categoryId}>
                    <div className="flex items-center justify-between gap-2 text-sm mb-1">
                      <span className="truncate">{line.name}</span>
                      <span className="shrink-0 text-muted-foreground tabular-nums">
                        <Money cents={line.actualCents} /> / <Money cents={line.plannedCents} />
                      </span>
                    </div>
                    <Progress
                      value={line.progress ?? 0}
                      label={line.name}
                      indicatorClassName={
                        line.status === "over" ? "bg-destructive" : "bg-amber-500"
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Letzte Buchungen</CardTitle>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/transactions">
              Alle <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {recentTransactions.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Noch keine Buchungen erfasst.
            </p>
          ) : (
            <ul className="divide-y">
              {recentTransactions.map((transaction) => (
                <li key={transaction.id} className="flex items-center gap-3 py-2">
                  <span className="text-xs text-muted-foreground tabular-nums w-20 shrink-0">
                    {formatDateCH(transaction.date)}
                  </span>
                  <span className="text-sm truncate flex-1">{transaction.description}</span>
                  {transaction.transferGroupId ? (
                    <Badge variant="secondary" className="shrink-0">
                      Umbuchung
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">
                      {transaction.category?.name ?? "Ohne Kategorie"}
                    </span>
                  )}
                  <span className="shrink-0 font-medium text-sm w-24 text-right">
                    <Money cents={transaction.amountCents} colored />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {hasCrypto && btcHistory && (
        <div className="grid gap-6 lg:grid-cols-3 mt-6">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Bitcoin-Kurs</CardTitle>
              <CardDescription>BTC/CHF</CardDescription>
            </CardHeader>
            <CardContent>
              <BtcPriceChart series={{ 7: btcHistory[0], 30: btcHistory[1], 365: btcHistory[2] }} />
            </CardContent>
          </Card>
          <Tile
            label="Bitcoin-Kurs"
            cents={btcToCents(1, currentBtcRateChf)}
            hint={currentBtcRateChf === null ? "Kurs momentan nicht verfügbar" : "pro BTC, live"}
          />
        </div>
      )}
    </>
  );
}

function Tile({
  label,
  cents,
  colored = false,
  hint,
}: {
  label: string;
  cents: number | null;
  colored?: boolean;
  hint?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">
          {cents === null ? (
            <span className="text-muted-foreground">–</span>
          ) : (
            <Money cents={cents} colored={colored} />
          )}
        </CardTitle>
      </CardHeader>
      {hint && (
        <CardContent className="pt-0">
          <p className="text-xs text-muted-foreground">{hint}</p>
        </CardContent>
      )}
    </Card>
  );
}
