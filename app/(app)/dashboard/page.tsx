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
import { goalStatus, reserveStatus, totalMonthlyReserveCents } from "@/lib/reserves";
import { pendingSuggestions, upcomingRecurring } from "@/lib/recurring";
import { categoryOptions } from "@/lib/categories";
import { formatMoney } from "@/lib/money";
import { colorFor } from "@/lib/colors";
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
import { TransactionRowActions } from "@/app/(app)/transactions/transaction-row-actions";
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
    goals,
    recurring,
    accounts,
    categories,
  ] = await Promise.all([
    // A past month shows the balances as they stood at its end; today's
    // balance next to May's income and expenses would read as May's.
    accountBalances(prisma, isCurrentMonth ? {} : { asOf: monthTo }),
    loadBudgetMonth(prisma, year, month),
    monthlySeries(prisma, trailingMonths(year, month, 12)),
    categoryBreakdown(prisma, monthFrom, monthTo, "Expense"),
    prisma.transaction.findMany({
      where: { date: { gte: monthFrom, lte: monthTo } },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      take: 8,
      include: {
        account: { select: { name: true, color: true } },
        category: { select: { name: true } },
      },
    }),
    prisma.reserve.findMany({
      where: { isActive: true },
      orderBy: [{ nextDueDate: "asc" }, { name: "asc" }],
    }),
    prisma.savingsGoal.findMany({ orderBy: [{ targetDate: "asc" }, { name: "asc" }] }),
    prisma.recurringTransaction.findMany({ where: { isActive: true } }),
    prisma.account.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    categoryOptions(prisma),
  ]);

  const suggestions = isCurrentMonth ? pendingSuggestions(recurring, today) : [];
  const upcoming = isCurrentMonth ? upcomingRecurring(recurring, today, 30) : [];
  const upcomingTotalCents = upcoming.reduce((sum, row) => sum + row.amountCents, 0);
  const reserveMonthly = totalMonthlyReserveCents(reserves, today);

  // Underfunded first, then whatever falls due next: a reserve that is already
  // short is the one item on this card that needs a decision today.
  const reserveStatuses = reserves
    .map((reserve) => reserveStatus(reserve, today))
    .sort((a, b) =>
      a.isShort === b.isShort
        ? a.nextDueDate.localeCompare(b.nextDueDate)
        : a.isShort
          ? -1
          : 1
    );
  const goalStatuses = goals
    .map((goal) => goalStatus(goal, today))
    .sort((a, b) => Number(a.isReached) - Number(b.isReached));
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
        <MonthNav year={year} month={month} basePath="/dashboard" today={today} />
        {canEdit && (
          <TransactionFormDialog accounts={accounts} categories={categories} today={today} />
        )}
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <Tile
          label={isCurrentMonth ? "Vermögen" : `Vermögen per ${formatDateCH(monthTo)}`}
          cents={netWorthCents(balances)}
          colored
          href="/accounts"
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
        <Tile
          label="Einnahmen (Monat)"
          cents={budget.totals.actualIncomeCents}
          href={`/transactions?type=income&from=${monthFrom}&to=${monthTo}`}
        />
        <Tile
          label="Ausgaben (Monat)"
          cents={budget.totals.actualExpenseCents}
          href={`/transactions?type=expense&from=${monthFrom}&to=${monthTo}`}
        />
        <Tile
          label="Saldo (Monat)"
          cents={budget.totals.actualBalanceCents}
          colored
          href={`/budget?year=${year}&month=${month}`}
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
            <CardDescription>
              {isCurrentMonth ? "" : `Stand ${formatDateCH(monthTo)} · `}
              Konto anklicken für seine Buchungen
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col">
              {balances.map((account) => (
                <li key={account.id}>
                  <Link
                    href={`/transactions?accountId=${account.id}&from=${monthFrom}&to=${monthTo}`}
                    // One link per account, and the booking list is a dynamic
                    // page: prefetching all of them renders it that many times.
                    prefetch={false}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 -mx-2 text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                  >
                    <span
                      className="size-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: account.color }}
                      aria-hidden
                    />
                    <span className="truncate">{account.name}</span>
                    {!isCurrentMonth && account.type === "Crypto" && (
                      // Only a live BTC price exists, so this one value is not
                      // the month-end figure the rest of the card shows.
                      <span className="text-xs text-muted-foreground shrink-0">aktueller Kurs</span>
                    )}
                    <span className="ml-auto shrink-0 font-medium">
                      <Money cents={account.balanceCents} colored />
                    </span>
                  </Link>
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
              <CardDescription>
                Kategorien nahe an oder über dem Budget — Zeile anklicken für die Buchungen
              </CardDescription>
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
                    <Link
                      href={`/transactions?categoryId=${line.categoryId}&from=${monthFrom}&to=${monthTo}`}
                      prefetch={false}
                      className="block rounded-md px-2 py-1 -mx-2 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                    >
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
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {(reserveStatuses.length > 0 || goalStatuses.length > 0 || upcoming.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-2 mb-6">
          {upcoming.length > 0 && (
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <CalendarClock className="h-4 w-4" />
                    Kommende 30 Tage
                  </CardTitle>
                  <CardDescription>
                    Wiederkehrende Buchungen, Saldo{" "}
                    {formatMoney(upcomingTotalCents, { withCurrency: true, forceSign: true })}
                  </CardDescription>
                </div>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/recurring">
                    Alle <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {upcoming.slice(0, 6).map((row) => (
                    <li key={row.id} className="flex items-center gap-3 py-2">
                      <span className="text-xs text-muted-foreground tabular-nums w-20 shrink-0">
                        {formatDateCH(row.nextDate)}
                      </span>
                      <span className="text-sm truncate flex-1">{row.name}</span>
                      {!row.autoPost && (
                        <Badge variant="outline" className="shrink-0">
                          Bestätigung
                        </Badge>
                      )}
                      <span className="shrink-0 font-medium text-sm">
                        <Money cents={row.amountCents} colored />
                      </span>
                    </li>
                  ))}
                </ul>
                {upcoming.length > 6 && (
                  <p className="text-xs text-muted-foreground mt-2">
                    und {upcoming.length - 6} weitere
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {(reserveStatuses.length > 0 || goalStatuses.length > 0) && (
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">Rückstellungen & Sparziele</CardTitle>
                  <CardDescription>
                    Monatlich zurückzulegen: {formatMoney(reserveMonthly, { withCurrency: true })}
                  </CardDescription>
                </div>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/reserves">
                    Alle <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {reserveStatuses.slice(0, 4).map((status) => (
                  <div key={`reserve-${status.id}`}>
                    <div className="flex items-center justify-between gap-2 text-sm mb-1">
                      <span className="truncate flex items-center gap-2">
                        {status.name}
                        {status.isShort ? (
                          <Badge variant="destructive">Unterdeckt</Badge>
                        ) : (
                          status.isDue && <Badge variant="secondary">Fällig</Badge>
                        )}
                      </span>
                      <span className="shrink-0 text-muted-foreground tabular-nums">
                        <Money cents={status.savedCents} /> / <Money cents={status.targetAmountCents} />
                      </span>
                    </div>
                    <Progress
                      value={status.progress}
                      label={status.name}
                      indicatorClassName={status.isShort ? "bg-destructive" : "bg-primary"}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      {status.missingCents === 0
                        ? `Vollständig · fällig am ${formatDateCH(status.nextDueDate)}`
                        : status.monthsRemaining > 0
                          ? `${formatMoney(status.monthlyRateCents, {
                              withCurrency: true,
                            })} pro Monat bis ${formatDateCH(status.nextDueDate)}`
                          : `Jetzt fällig — es fehlen ${formatMoney(status.missingCents, {
                              withCurrency: true,
                            })}`}
                    </p>
                  </div>
                ))}

                {goalStatuses.slice(0, 2).map((status) => (
                  <div key={`goal-${status.id}`}>
                    <div className="flex items-center justify-between gap-2 text-sm mb-1">
                      <span className="truncate flex items-center gap-2">
                        <span
                          className="size-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: status.color ?? "#6366f1" }}
                          aria-hidden
                        />
                        {status.name}
                        {status.isReached && (
                          <Badge className="bg-emerald-500 text-white border-transparent">
                            Erreicht
                          </Badge>
                        )}
                      </span>
                      <span className="shrink-0 text-muted-foreground tabular-nums">
                        <Money cents={status.savedCents} /> / <Money cents={status.targetAmountCents} />
                      </span>
                    </div>
                    <Progress
                      value={status.progress}
                      label={status.name}
                      indicatorClassName={status.isReached ? "bg-emerald-500" : "bg-primary"}
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

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
                <li key={transaction.id} className="group flex items-center gap-3 py-2">
                  <span className="text-xs text-muted-foreground tabular-nums w-20 shrink-0">
                    {formatDateCH(transaction.date)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-sm block truncate">{transaction.description}</span>
                    <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <span
                        className="size-2 rounded-full shrink-0"
                        style={{ backgroundColor: colorFor(transaction.accountId, transaction.account.color) }}
                        aria-hidden
                      />
                      <span className="truncate">{transaction.account.name}</span>
                    </span>
                  </span>
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
                  {canEdit && (
                    <TransactionRowActions
                      transaction={transaction}
                      accounts={accounts}
                      categories={categories}
                      today={today}
                    />
                  )}
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
  href,
}: {
  label: string;
  cents: number | null;
  colored?: boolean;
  hint?: string;
  /** Makes the whole tile a link to the figure's detail view. */
  href?: string;
}) {
  const card = (
    <Card className={href ? "h-full transition-colors hover:border-primary/60" : undefined}>
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

  if (!href) return card;
  return (
    // The linked pages are dynamic; prefetching four of them on every dashboard
    // render costs four extra server renders for a link that may never be used.
    <Link href={href} prefetch={false} className="rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
      {card}
    </Link>
  );
}
