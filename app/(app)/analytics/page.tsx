import Link from "next/link";
import prisma from "@/lib/prisma";
import { requireSession } from "@/lib/permissions";
import { config } from "@/lib/config";
import { todayInZone, trailingMonths, yearRange } from "@/lib/date";
import {
  categoryBreakdown,
  monthlySeries,
  netWorthSeries,
  topCounterparties,
} from "@/lib/analytics";
import { PageHeader } from "@/components/page-header";
import { Money } from "@/components/money";
import { MonthlyBarChart } from "@/components/charts/monthly-bar-chart";
import { CategoryPieChart } from "@/components/charts/category-pie-chart";
import { NetWorthChart } from "@/components/charts/net-worth-chart";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AnalyticsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();

  const raw = await searchParams;
  const today = todayInZone(config.recurring.timezone);
  const currentYear = parseInt(today.slice(0, 4), 10);
  const year = parseInt(String(raw.year ?? currentYear), 10) || currentYear;

  const { from, to } = yearRange(year);
  // For the running year, stop at today — a partial year compared against a
  // full one would make every average look wrong.
  const rangeEnd = year === currentYear ? today : to;

  const months = Array.from({ length: 12 }, (_, index) => ({ year, month: index + 1 }));

  const [series, expenses, income, netWorth, counterparties] = await Promise.all([
    monthlySeries(prisma, months),
    categoryBreakdown(prisma, from, rangeEnd, "Expense"),
    categoryBreakdown(prisma, from, rangeEnd, "Income"),
    netWorthSeries(prisma, trailingMonths(currentYear, parseInt(today.slice(5, 7), 10), 24)),
    topCounterparties(prisma, from, rangeEnd, 10),
  ]);

  const totalIncome = series.reduce((sum, month) => sum + month.incomeCents, 0);
  const totalExpense = series.reduce((sum, month) => sum + month.expenseCents, 0);
  // Only elapsed months count towards the average, otherwise the running year
  // is divided by twelve and reads far too low.
  const elapsedMonths = year === currentYear ? parseInt(today.slice(5, 7), 10) : 12;

  // Year picker bounds from the first and last booking, rather than a distinct
  // scan over every date in the table.
  const bounds = await prisma.transaction.aggregate({
    _min: { date: true },
    _max: { date: true },
  });
  const firstYear = bounds._min.date ? parseInt(bounds._min.date.slice(0, 4), 10) : currentYear;
  const lastYear = Math.max(
    bounds._max.date ? parseInt(bounds._max.date.slice(0, 4), 10) : currentYear,
    currentYear
  );
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => firstYear + i);

  return (
    <>
      <PageHeader title="Auswertungen" description={`Jahr ${year}`}>
        <div className="flex flex-wrap gap-1">
          {years.map((option) => (
            <Button
              key={option}
              variant={option === year ? "default" : "outline"}
              size="sm"
              asChild
            >
              <Link href={`/analytics?year=${option}`}>{option}</Link>
            </Button>
          ))}
        </div>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <Tile label="Einnahmen" cents={totalIncome} />
        <Tile label="Ausgaben" cents={totalExpense} />
        <Tile label="Saldo" cents={totalIncome - totalExpense} colored />
        <Tile
          label="Ø Ausgaben pro Monat"
          cents={elapsedMonths > 0 ? Math.round(totalExpense / elapsedMonths) : 0}
        />
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Monatsverlauf {year}</CardTitle>
          <CardDescription>Ohne Umbuchungen zwischen eigenen Konten</CardDescription>
        </CardHeader>
        <CardContent>
          <MonthlyBarChart data={series} height={320} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ausgaben nach Kategorie</CardTitle>
            <CardDescription>Slice anklicken für die zugehörigen Buchungen</CardDescription>
          </CardHeader>
          <CardContent>
            <CategoryPieChart slices={expenses} from={from} to={rangeEnd} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Einnahmen nach Kategorie</CardTitle>
            <CardDescription>Woher das Geld kommt</CardDescription>
          </CardHeader>
          <CardContent>
            <CategoryPieChart slices={income} from={from} to={rangeEnd} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Vermögensentwicklung</CardTitle>
            <CardDescription>
              Alle Konten, letzte 24 Monate — inklusive Umbuchungen
            </CardDescription>
          </CardHeader>
          <CardContent>
            <NetWorthChart data={netWorth} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Grösste Empfänger</CardTitle>
            <CardDescription>Wohin das Geld {year} geflossen ist</CardDescription>
          </CardHeader>
          <CardContent>
            {counterparties.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Keine Ausgaben in diesem Zeitraum.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {counterparties.map((entry) => (
                  <li key={entry.name} className="flex items-center gap-3 text-sm">
                    <span className="truncate flex-1">{entry.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                      {entry.transactionCount}×
                    </span>
                    <span className="shrink-0 font-medium tabular-nums w-24 text-right">
                      <Money cents={entry.amountCents} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Tile({ label, cents, colored = false }: { label: string; cents: number; colored?: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">
          <Money cents={cents} colored={colored} />
        </CardTitle>
      </CardHeader>
    </Card>
  );
}
