import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import prisma from "@/lib/prisma";
import { hasRole, requireSession } from "@/lib/permissions";
import { loadBudgetMonth, type BudgetStatus } from "@/lib/budget";
import { config } from "@/lib/config";
import { monthName, todayInZone } from "@/lib/date";
import { totalMonthlyReserveCents } from "@/lib/reserves";
import { PageHeader } from "@/components/page-header";
import { MonthNav } from "@/components/month-nav";
import { Money } from "@/components/money";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BudgetAmountInput } from "./budget-amount-input";
import { CopyPreviousButton } from "./copy-previous-button";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const STATUS_BAR: Record<BudgetStatus, string> = {
  unbudgeted: "bg-muted-foreground/40",
  ok: "bg-emerald-500",
  warning: "bg-amber-500",
  over: "bg-destructive",
};

export default async function BudgetPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireSession();
  const canEdit = hasRole(session, ["Admin", "Editor"]);

  const raw = await searchParams;
  const today = todayInZone(config.recurring.timezone);
  const [currentYear, currentMonth] = today.split("-").map(Number);

  const year = parseInt(String(raw.year ?? currentYear), 10) || currentYear;
  const month = Math.min(12, Math.max(1, parseInt(String(raw.month ?? currentMonth), 10) || currentMonth));

  const [budget, reserves] = await Promise.all([
    loadBudgetMonth(prisma, year, month),
    prisma.reserve.findMany({ where: { isActive: true } }),
  ]);
  const reserveMonthly = totalMonthlyReserveCents(reserves, today);

  const { totals } = budget;
  // What is actually free after the month's plan and the monthly share of the
  // yearly bills — the number a household actually wants to know.
  const freeCents = totals.actualBalanceCents - reserveMonthly;

  return (
    <>
      <PageHeader
        title="Budget"
        description="Soll gegen Ist pro Kategorie. Umbuchungen zwischen eigenen Konten zählen nicht mit."
      >
        <MonthNav year={year} month={month} basePath="/budget" />
        {canEdit && <CopyPreviousButton year={year} month={month} />}
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <SummaryTile
          label="Einnahmen"
          actual={totals.actualIncomeCents}
          planned={totals.plannedIncomeCents}
        />
        <SummaryTile
          label="Ausgaben"
          actual={totals.actualExpenseCents}
          planned={totals.plannedExpenseCents}
        />
        <SummaryTile
          label="Saldo"
          actual={totals.actualBalanceCents}
          planned={totals.plannedBalanceCents}
          colored
        />
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Frei nach Rückstellungen</CardDescription>
            <CardTitle className="text-2xl">
              <Money cents={freeCents} colored />
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-xs text-muted-foreground">
              Saldo abzüglich <Money cents={reserveMonthly} /> monatlicher Rückstellungen
            </p>
          </CardContent>
        </Card>
      </div>

      {totals.uncategorizedCount > 0 && (
        <Card className="mb-6 border-amber-500/50">
          <CardContent className="flex items-start gap-3 py-4">
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium">
                {totals.uncategorizedCount} Buchung(en) ohne Kategorie im{" "}
                {monthName(month)} {year}
              </p>
              <p className="text-muted-foreground">
                Zusammen <Money cents={totals.uncategorizedCents} colored /> — solange sie nicht
                zugeordnet sind, fehlen sie in jeder Auswertung.{" "}
                <Link
                  href={`/transactions?categoryId=none&from=${year}-${String(month).padStart(2, "0")}-01`}
                  className="text-primary underline"
                >
                  Jetzt zuordnen
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {budget.groups.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              Noch keine Kategorien angelegt.{" "}
              <Link href="/categories" className="text-primary underline">
                Zu den Kategorien
              </Link>
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {budget.groups.map((group) => (
            <Card key={`${group.kind}-${group.parentId}`}>
              <CardHeader className="flex-row items-baseline justify-between gap-2 pb-3">
                <CardTitle className="text-base">{group.parentName}</CardTitle>
                <div className="text-sm text-muted-foreground tabular-nums">
                  <Money cents={group.actualCents} /> von <Money cents={group.plannedCents} />
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <ul className="divide-y">
                  {group.lines.map((line) => (
                    <li key={line.categoryId} className="py-3">
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <Link
                              href={`/transactions?categoryId=${line.categoryId}&from=${year}-${String(month).padStart(2, "0")}-01`}
                              className="text-sm font-medium hover:underline truncate"
                            >
                              {line.name}
                            </Link>
                            {line.status === "over" && (
                              <Badge variant="destructive">Überschritten</Badge>
                            )}
                            {line.status === "warning" && (
                              <Badge className="bg-amber-500 text-white border-transparent">
                                Fast ausgeschöpft
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            <Money cents={line.actualCents} /> von{" "}
                            <Money cents={line.plannedCents} />
                            {line.plannedCents > 0 && (
                              <>
                                {" · "}
                                {line.remainingCents >= 0 ? "noch " : "über "}
                                <Money cents={Math.abs(line.remainingCents)} />
                              </>
                            )}
                            {line.transactionCount > 0 && ` · ${line.transactionCount} Buchung(en)`}
                          </p>
                        </div>
                        <BudgetAmountInput
                          key={`${line.categoryId}-${year}-${month}`}
                          categoryId={line.categoryId}
                          year={year}
                          month={month}
                          plannedCents={line.plannedCents}
                          disabled={!canEdit}
                        />
                      </div>
                      {line.plannedCents > 0 && (
                        <Progress
                          value={line.progress ?? 0}
                          label={line.name}
                          className="mt-2"
                          indicatorClassName={STATUS_BAR[line.status]}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function SummaryTile({
  label,
  actual,
  planned,
  colored = false,
}: {
  label: string;
  actual: number;
  planned: number;
  colored?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">
          <Money cents={actual} colored={colored} />
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-xs text-muted-foreground">
          Budgetiert: <Money cents={planned} />
        </p>
      </CardContent>
    </Card>
  );
}
