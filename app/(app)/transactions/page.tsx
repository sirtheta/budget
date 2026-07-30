import Link from "next/link";
import { ArrowLeftRight, Download, Plus, SplitSquareHorizontal } from "lucide-react";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireSession } from "@/lib/permissions";
import { hasRole } from "@/lib/permissions";
import { categoryOptions } from "@/lib/categories";
import { transactionSearchFilter } from "@/lib/search";
import { config } from "@/lib/config";
import { formatMoney } from "@/lib/money";
import { formatDateCH, todayInZone } from "@/lib/date";
import { PageHeader } from "@/components/page-header";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TransactionFormDialog } from "./transaction-form-dialog";
import { TransactionFilters } from "./transaction-filters";
import { TransactionRowActions } from "./transaction-row-actions";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Turns the URL filters into a Prisma `where`. */
function buildWhere(params: Record<string, string | undefined>): Prisma.TransactionWhereInput {
  const where: Prisma.TransactionWhereInput = {};

  if (params.from || params.to) {
    where.date = {
      ...(params.from ? { gte: params.from } : {}),
      ...(params.to ? { lte: params.to } : {}),
    };
  }
  if (params.accountId) where.accountId = parseInt(params.accountId, 10);
  if (params.categoryId === "none") {
    where.categoryId = null;
    where.transferGroupId = null;
  } else if (params.categoryId) where.categoryId = parseInt(params.categoryId, 10);

  if (params.type === "transfer") where.transferGroupId = { not: null };
  else if (params.type === "income") {
    where.amountCents = { gt: 0 };
    where.transferGroupId = null;
  } else if (params.type === "expense") {
    where.amountCents = { lt: 0 };
    where.transferGroupId = null;
  }

  const search = transactionSearchFilter(params.q);
  if (search) where.OR = search;

  return where;
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await requireSession();
  const canEdit = hasRole(session, ["Admin", "Editor"]);
  const raw = await searchParams;

  const params = {
    q: single(raw.q),
    from: single(raw.from),
    to: single(raw.to),
    accountId: single(raw.accountId),
    categoryId: single(raw.categoryId),
    type: single(raw.type),
  };
  const page = Math.max(1, parseInt(single(raw.page) ?? "1", 10) || 1);
  const where = buildWhere(params);

  const [transactions, total, sum, accounts, categories] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: [{ date: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        account: { select: { name: true, color: true } },
        category: { select: { name: true, color: true, parent: { select: { name: true } } } },
      },
    }),
    prisma.transaction.count({ where }),
    prisma.transaction.aggregate({ where, _sum: { amountCents: true } }),
    prisma.account.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    categoryOptions(prisma),
  ]);

  const today = todayInZone(config.recurring.timezone);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const pageLink = (target: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) next.set(key, value);
    if (target > 1) next.set("page", String(target));
    const query = next.toString();
    return query ? `/transactions?${query}` : "/transactions";
  };

  return (
    <>
      <PageHeader
        title="Buchungen"
        description={`${total} Buchung(en) · Saldo der Auswahl: ${formatMoney(
          sum._sum.amountCents ?? 0,
          { withCurrency: true, forceSign: true }
        )}`}
      >
        <Button variant="outline" asChild>
          <a href={`/api/transactions/export?${new URLSearchParams(
            Object.entries(params).filter(([, v]) => !!v) as [string, string][]
          ).toString()}`}>
            <Download className="h-4 w-4" /> CSV
          </a>
        </Button>
        {canEdit && accounts.length > 0 && (
          <TransactionFormDialog
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

      {accounts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              Es gibt noch kein Konto. Lege zuerst unter{" "}
              <Link href="/accounts" className="text-primary underline">
                Konten
              </Link>{" "}
              eines an.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <TransactionFilters accounts={accounts} categories={categories} />

          <Card>
            <CardContent className="p-0">
              {transactions.length === 0 ? (
                <p className="p-8 text-center text-sm text-muted-foreground">
                  Keine Buchungen für diese Auswahl.
                </p>
              ) : (
                <>
                <div className="hidden md:block overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-28">Datum</TableHead>
                        <TableHead>Beschreibung</TableHead>
                        <TableHead>Kategorie</TableHead>
                        <TableHead>Konto</TableHead>
                        <TableHead className="text-right w-32">Betrag</TableHead>
                        {canEdit && <TableHead className="w-20" />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {transactions.map((transaction) => (
                        <TableRow key={transaction.id} className="group">
                          <TableCell className="text-muted-foreground tabular-nums text-sm">
                            {formatDateCH(transaction.date)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {transaction.transferGroupId && (
                                <ArrowLeftRight
                                  className="h-3.5 w-3.5 text-muted-foreground shrink-0"
                                  aria-label="Umbuchung"
                                />
                              )}
                              {transaction.splitGroupId && (
                                <SplitSquareHorizontal
                                  className="h-3.5 w-3.5 text-muted-foreground shrink-0"
                                  aria-label="Aufgeteilte Buchung"
                                />
                              )}
                              <span className="font-medium">{transaction.description}</span>
                            </div>
                            {transaction.counterparty && (
                              <p className="text-xs text-muted-foreground">
                                {transaction.counterparty}
                              </p>
                            )}
                          </TableCell>
                          <TableCell>
                            {transaction.transferGroupId ? (
                              <Badge variant="secondary">Umbuchung</Badge>
                            ) : transaction.category ? (
                              <span className="text-sm">
                                {transaction.category.parent && (
                                  <span className="text-muted-foreground">
                                    {transaction.category.parent.name} ›{" "}
                                  </span>
                                )}
                                {transaction.category.name}
                              </span>
                            ) : (
                              <Badge variant="outline" className="text-muted-foreground">
                                Ohne Kategorie
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {transaction.account.name}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            <Money cents={transaction.amountCents} colored />
                          </TableCell>
                          {canEdit && (
                            <TableCell>
                              <TransactionRowActions
                                transaction={transaction}
                                accounts={accounts}
                                categories={categories}
                                today={today}
                              />
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <ul className="md:hidden divide-y">
                  {transactions.map((transaction) => (
                    <li key={transaction.id} className="flex items-start gap-3 p-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {transaction.transferGroupId && (
                            <ArrowLeftRight
                              className="h-3.5 w-3.5 text-muted-foreground shrink-0"
                              aria-label="Umbuchung"
                            />
                          )}
                          {transaction.splitGroupId && (
                            <SplitSquareHorizontal
                              className="h-3.5 w-3.5 text-muted-foreground shrink-0"
                              aria-label="Aufgeteilte Buchung"
                            />
                          )}
                          <span className="font-medium truncate">{transaction.description}</span>
                        </div>
                        {transaction.counterparty && (
                          <p className="text-xs text-muted-foreground truncate">
                            {transaction.counterparty}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {formatDateCH(transaction.date)} · {transaction.account.name}
                        </p>
                        <div className="mt-1">
                          {transaction.transferGroupId ? (
                            <Badge variant="secondary">Umbuchung</Badge>
                          ) : transaction.category ? (
                            <span className="text-xs text-muted-foreground">
                              {transaction.category.parent && (
                                <>{transaction.category.parent.name} › </>
                              )}
                              {transaction.category.name}
                            </span>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">
                              Ohne Kategorie
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <span className="font-medium">
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
                      </div>
                    </li>
                  ))}
                </ul>
                </>
              )}
            </CardContent>
          </Card>

          {pageCount > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-muted-foreground">
                Seite {page} von {pageCount}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" asChild disabled={page <= 1}>
                  <Link href={pageLink(page - 1)} aria-disabled={page <= 1}>
                    Zurück
                  </Link>
                </Button>
                <Button variant="outline" size="sm" asChild disabled={page >= pageCount}>
                  <Link href={pageLink(page + 1)} aria-disabled={page >= pageCount}>
                    Weiter
                  </Link>
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
