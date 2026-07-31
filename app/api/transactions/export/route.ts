import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { attachmentHeader, csvAmount, toCsv } from "@/lib/csv-export";
import { transactionSearchFilter } from "@/lib/search";
import { formatDateCH, toDateString } from "@/lib/date";

/**
 * CSV export of the transaction list, honouring the same filters as the page
 * so "export what I'm looking at" does what it says.
 *
 * An API route rather than a Server Action because the response is a file
 * stream, not a mutation.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const where: Prisma.TransactionWhereInput = {};

  const from = params.get("from");
  const to = params.get("to");
  if (from || to) {
    where.date = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  }

  const accountId = params.get("accountId");
  if (accountId) where.accountId = parseInt(accountId, 10);

  const categoryId = params.get("categoryId");
  if (categoryId === "none") {
    where.categoryId = null;
    where.transferGroupId = null;
  } else if (categoryId) where.categoryId = parseInt(categoryId, 10);

  const type = params.get("type");
  if (type === "transfer") where.transferGroupId = { not: null };
  else if (type === "income") {
    where.amountCents = { gt: 0 };
    where.transferGroupId = null;
  } else if (type === "expense") {
    where.amountCents = { lt: 0 };
    where.transferGroupId = null;
  }

  // Same helper as the page, so "export what I'm looking at" keeps meaning it.
  const search = transactionSearchFilter(params.get("q"));
  if (search) where.OR = search;

  const transactions = await prisma.transaction.findMany({
    where,
    orderBy: [{ date: "asc" }, { id: "asc" }],
    include: {
      account: { select: { name: true } },
      category: { select: { name: true, parent: { select: { name: true } } } },
    },
  });

  const csv = toCsv(transactions, [
    { header: "Datum", value: (t) => formatDateCH(t.date) },
    { header: "Beschreibung", value: (t) => t.description },
    { header: "Gegenpartei", value: (t) => t.counterparty ?? "" },
    { header: "Gruppe", value: (t) => t.category?.parent?.name ?? "" },
    { header: "Kategorie", value: (t) => t.category?.name ?? "" },
    { header: "Konto", value: (t) => t.account.name },
    { header: "Betrag CHF", value: (t) => csvAmount(t.amountCents) },
    { header: "Umbuchung", value: (t) => (t.transferGroupId ? "ja" : "") },
    { header: "Notiz", value: (t) => t.notes ?? "" },
  ]);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": attachmentHeader(`buchungen-${toDateString(new Date())}.csv`),
      "Cache-Control": "no-store",
    },
  });
}
