import { AlertTriangle } from "lucide-react";
import prisma from "@/lib/prisma";
import { hasRole, requireSession } from "@/lib/permissions";
import { config } from "@/lib/config";
import { formatDateCH, todayInZone } from "@/lib/date";
import { goalStatus, reserveStatus, totalMonthlyReserveCents } from "@/lib/reserves";
import { intervalLabel } from "@/lib/recurring";
import { categoryOptions } from "@/lib/categories";
import { PageHeader } from "@/components/page-header";
import { Money } from "@/components/money";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ReserveFormDialog } from "./reserve-form-dialog";
import { GoalFormDialog } from "./goal-form-dialog";
import { AddToPot, DeletePotButton, SettleReserveButton } from "./reserve-actions";

export const dynamic = "force-dynamic";

export default async function ReservesPage() {
  const session = await requireSession();
  const canEdit = hasRole(session, ["Admin", "Editor"]);
  const today = todayInZone(config.recurring.timezone);

  const [reserves, goals, accounts, categories] = await Promise.all([
    prisma.reserve.findMany({ orderBy: [{ nextDueDate: "asc" }, { name: "asc" }] }),
    prisma.savingsGoal.findMany({ orderBy: [{ targetDate: "asc" }, { name: "asc" }] }),
    prisma.account.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    categoryOptions(prisma),
  ]);

  const reserveStatuses = reserves.map((reserve) => ({
    reserve,
    status: reserveStatus(reserve, today),
  }));
  const goalStatuses = goals.map((goal) => ({ goal, status: goalStatus(goal, today) }));

  const monthlyTotal = totalMonthlyReserveCents(reserves, today);
  const setAsideTotal = reserves.reduce((sum, r) => sum + r.savedCents, 0);
  const shortfalls = reserveStatuses.filter(({ status }) => status.isShort);

  return (
    <>
      <PageHeader
        title="Rückstellungen & Sparziele"
        description="Für Kosten, die nicht monatlich anfallen — und für das, worauf du sparst."
      >
        {canEdit && (
          <>
            <GoalFormDialog accounts={accounts} />
            <ReserveFormDialog accounts={accounts} categories={categories} today={today} />
          </>
        )}
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Monatlich zurückzulegen</CardDescription>
            <CardTitle className="text-2xl">
              <Money cents={monthlyTotal} withCurrency />
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Bereits zurückgelegt</CardDescription>
            <CardTitle className="text-2xl">
              <Money cents={setAsideTotal} withCurrency />
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Sparziele</CardDescription>
            <CardTitle className="text-2xl">
              <Money
                cents={goals.reduce((sum, g) => sum + g.savedCents, 0)}
                withCurrency
              />
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {shortfalls.length > 0 && (
        <Card className="mb-6 border-destructive/50">
          <CardContent className="flex items-start gap-3 py-4">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium">
                {shortfalls.length} Rückstellung(en) fällig und nicht gedeckt
              </p>
              <p className="text-muted-foreground">
                {shortfalls.map(({ reserve, status }) => (
                  <span key={reserve.id} className="block">
                    {reserve.name}: es fehlen <Money cents={status.missingCents} colored />
                  </span>
                ))}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
        Rückstellungen
      </h2>
      {reserves.length === 0 ? (
        <Card className="mb-8">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Noch keine Rückstellungen. Typische Fälle: Krankenkasse, Steuern, Autoversicherung,
            Serafe — alles, was jährlich oder halbjährlich kommt.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 mb-8">
          {reserveStatuses.map(({ reserve, status }) => (
            <Card key={reserve.id} className={reserve.isActive ? "" : "opacity-55"}>
              <CardHeader className="flex-row items-start justify-between gap-2 pb-3">
                <div className="min-w-0">
                  <CardTitle className="text-base flex items-center gap-2">
                    {reserve.name}
                    {status.isShort && <Badge variant="destructive">Unterdeckt</Badge>}
                    {status.isDue && !status.isShort && <Badge variant="secondary">Fällig</Badge>}
                  </CardTitle>
                  <CardDescription>
                    {intervalLabel(reserve.intervalMonths)} ·{" "}
                    <Money cents={reserve.targetAmountCents} withCurrency /> · fällig am{" "}
                    {formatDateCH(reserve.nextDueDate)}
                  </CardDescription>
                </div>
                {canEdit && (
                  <div className="flex items-center shrink-0">
                    <ReserveFormDialog
                      reserve={reserve}
                      accounts={accounts}
                      categories={categories}
                      today={today}
                    />
                    <DeletePotButton id={reserve.id} name={reserve.name} kind="reserve" />
                  </div>
                )}
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div>
                  <div className="flex justify-between text-sm mb-1.5">
                    <span>
                      <Money cents={reserve.savedCents} /> von{" "}
                      <Money cents={reserve.targetAmountCents} />
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {Math.round(status.progress * 100)} %
                    </span>
                  </div>
                  <Progress
                    value={status.progress}
                    label={reserve.name}
                    indicatorClassName={status.isShort ? "bg-destructive" : "bg-primary"}
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  {status.missingCents === 0 ? (
                    "Vollständig zurückgelegt."
                  ) : status.monthsRemaining > 0 ? (
                    <>
                      Noch {status.monthsRemaining} Monat(e) — dafür monatlich{" "}
                      <strong className="text-foreground">
                        <Money cents={status.monthlyRateCents} withCurrency />
                      </strong>
                    </>
                  ) : (
                    <>
                      Jetzt fällig — es fehlen{" "}
                      <strong className="text-destructive">
                        <Money cents={status.missingCents} withCurrency />
                      </strong>
                    </>
                  )}
                </p>
                {canEdit && (
                  <div className="flex items-center justify-between gap-2">
                    <AddToPot
                      id={reserve.id}
                      kind="reserve"
                      suggestionCents={status.monthlyRateCents}
                    />
                    {status.isDue && <SettleReserveButton id={reserve.id} name={reserve.name} />}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
        Sparziele
      </h2>
      {goals.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Noch keine Sparziele.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {goalStatuses.map(({ goal, status }) => (
            <Card key={goal.id}>
              <CardHeader className="flex-row items-start justify-between gap-2 pb-3">
                <div className="min-w-0">
                  <CardTitle className="text-base flex items-center gap-2">
                    <span
                      className="size-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: goal.color ?? "#6366f1" }}
                      aria-hidden
                    />
                    {goal.name}
                    {status.isReached && (
                      <Badge className="bg-emerald-500 text-white border-transparent">
                        Erreicht
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription>
                    Ziel: <Money cents={goal.targetAmountCents} withCurrency />
                    {goal.targetDate && ` · bis ${formatDateCH(goal.targetDate)}`}
                  </CardDescription>
                </div>
                {canEdit && (
                  <div className="flex items-center shrink-0">
                    <GoalFormDialog goal={goal} accounts={accounts} />
                    <DeletePotButton id={goal.id} name={goal.name} kind="goal" />
                  </div>
                )}
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div>
                  <div className="flex justify-between text-sm mb-1.5">
                    <span>
                      <Money cents={goal.savedCents} /> von{" "}
                      <Money cents={goal.targetAmountCents} />
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {Math.round(status.progress * 100)} %
                    </span>
                  </div>
                  <Progress
                    value={status.progress}
                    label={goal.name}
                    indicatorClassName={status.isReached ? "bg-emerald-500" : "bg-primary"}
                  />
                </div>
                {status.monthlyRateCents !== null && (
                  <p className="text-sm text-muted-foreground">
                    Für das Zieldatum monatlich{" "}
                    <strong className="text-foreground">
                      <Money cents={status.monthlyRateCents} withCurrency />
                    </strong>
                  </p>
                )}
                {canEdit && (
                  <AddToPot
                    id={goal.id}
                    kind="goal"
                    suggestionCents={status.monthlyRateCents}
                  />
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
