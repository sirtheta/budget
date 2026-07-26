import { ArrowLeftRight, Plus } from "lucide-react";
import prisma from "@/lib/prisma";
import { requireEditor } from "@/lib/permissions";
import { config } from "@/lib/config";
import { formatDateCH, todayInZone } from "@/lib/date";
import { intervalLabel } from "@/lib/recurring";
import { categoryOptions } from "@/lib/categories";
import { PageHeader } from "@/components/page-header";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
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
import { RecurringFormDialog } from "./recurring-form-dialog";
import { RecurringRowActions, RunNowButton } from "./recurring-row-actions";

export const dynamic = "force-dynamic";

export default async function RecurringPage() {
  await requireEditor();
  const today = todayInZone(config.recurring.timezone);

  const [rows, accounts, categories] = await Promise.all([
    prisma.recurringTransaction.findMany({
      orderBy: [{ isActive: "desc" }, { nextDate: "asc" }],
      include: {
        account: { select: { name: true } },
        counterAccount: { select: { name: true } },
        category: { select: { name: true, parent: { select: { name: true } } } },
      },
    }),
    prisma.account.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    categoryOptions(prisma),
  ]);

  // Normalised to a monthly figure so quarterly and yearly entries are
  // comparable — a yearly CHF 1200 insurance is CHF 100 a month of commitment.
  const monthlyCommitment = rows
    .filter((row) => row.isActive && row.counterAccountId === null && row.amountCents < 0)
    .reduce((sum, row) => sum + Math.abs(row.amountCents) / row.intervalMonths, 0);

  return (
    <>
      <PageHeader
        title="Wiederkehrende Buchungen"
        description="Werden automatisch erfasst, sobald sie fällig sind — auch rückwirkend, wenn die App zwischenzeitlich aus war."
      >
        <RunNowButton />
        {accounts.length > 0 && (
          <RecurringFormDialog
            accounts={accounts}
            categories={categories}
            today={today}
            trigger={
              <Button>
                <Plus className="h-4 w-4" /> Neue Buchung
              </Button>
            }
          />
        )}
      </PageHeader>

      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardDescription>Feste Ausgaben, auf den Monat umgerechnet</CardDescription>
          <CardTitle className="text-2xl">
            <Money cents={Math.round(monthlyCommitment)} withCurrency />
          </CardTitle>
        </CardHeader>
      </Card>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Noch nichts erfasst. Typisch: Miete, Krankenkasse, Abos, ÖV-Abo, Dauerauftrag aufs
              Sparkonto.
            </p>
          ) : (
            <>
            <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bezeichnung</TableHead>
                    <TableHead>Rhythmus</TableHead>
                    <TableHead>Nächste</TableHead>
                    <TableHead>Konto / Kategorie</TableHead>
                    <TableHead className="text-right">Betrag</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const isDue = row.isActive && row.nextDate <= today;
                    return (
                      <TableRow key={row.id} className={row.isActive ? "" : "opacity-55"}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {row.counterAccountId && (
                              <ArrowLeftRight
                                className="h-3.5 w-3.5 text-muted-foreground shrink-0"
                                aria-label="Umbuchung"
                              />
                            )}
                            <span className="font-medium">{row.name}</span>
                            {!row.isActive && <Badge variant="outline">Pausiert</Badge>}
                            {!row.autoPost && <Badge variant="secondary">Nur Vorschlag</Badge>}
                          </div>
                          {row.endDate && (
                            <p className="text-xs text-muted-foreground">
                              endet am {formatDateCH(row.endDate)}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {intervalLabel(row.intervalMonths)}
                        </TableCell>
                        <TableCell className="tabular-nums text-sm">
                          {formatDateCH(row.nextDate)}
                          {isDue && (
                            <Badge variant="destructive" className="ml-2">
                              Fällig
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {row.account.name}
                          {row.counterAccount ? (
                            <> → {row.counterAccount.name}</>
                          ) : row.category ? (
                            <>
                              {" · "}
                              {row.category.parent && `${row.category.parent.name} › `}
                              {row.category.name}
                            </>
                          ) : (
                            " · ohne Kategorie"
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          <Money
                            cents={row.counterAccountId ? -Math.abs(row.amountCents) : row.amountCents}
                            colored={!row.counterAccountId}
                          />
                        </TableCell>
                        <TableCell>
                          <RecurringRowActions
                            recurring={row}
                            accounts={accounts}
                            categories={categories}
                            today={today}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <ul className="md:hidden divide-y">
              {rows.map((row) => {
                const isDue = row.isActive && row.nextDate <= today;
                return (
                  <li key={row.id} className={`p-4 ${row.isActive ? "" : "opacity-55"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {row.counterAccountId && (
                            <ArrowLeftRight
                              className="h-3.5 w-3.5 text-muted-foreground shrink-0"
                              aria-label="Umbuchung"
                            />
                          )}
                          <span className="font-medium">{row.name}</span>
                          {!row.isActive && <Badge variant="outline">Pausiert</Badge>}
                          {!row.autoPost && <Badge variant="secondary">Nur Vorschlag</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {intervalLabel(row.intervalMonths)} · nächste {formatDateCH(row.nextDate)}
                          {isDue && (
                            <Badge variant="destructive" className="ml-2">
                              Fällig
                            </Badge>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {row.account.name}
                          {row.counterAccount ? (
                            <> → {row.counterAccount.name}</>
                          ) : row.category ? (
                            <>
                              {" · "}
                              {row.category.parent && `${row.category.parent.name} › `}
                              {row.category.name}
                            </>
                          ) : (
                            " · ohne Kategorie"
                          )}
                        </p>
                        {row.endDate && (
                          <p className="text-xs text-muted-foreground">
                            endet am {formatDateCH(row.endDate)}
                          </p>
                        )}
                      </div>
                      <p className="font-medium shrink-0">
                        <Money
                          cents={row.counterAccountId ? -Math.abs(row.amountCents) : row.amountCents}
                          colored={!row.counterAccountId}
                        />
                      </p>
                    </div>
                    <div className="flex justify-end mt-2">
                      <RecurringRowActions
                        recurring={row}
                        accounts={accounts}
                        categories={categories}
                        today={today}
                      />
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
