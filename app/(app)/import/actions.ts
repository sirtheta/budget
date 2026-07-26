"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ImportFormat } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireEditor } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { config } from "@/lib/config";
import { addDays, isValidDateString } from "@/lib/date";
import { parseCamt053 } from "@/lib/import/camt";
import { detectDelimiter, parseCsvStatement, previewRows, type CsvParseResult } from "@/lib/import/csv";
import { withHashes } from "@/lib/import/dedupe";
import { matchRule } from "@/lib/import/rules";
import {
  TRANSFER_MATCH_TOLERANCE_DAYS,
  adoptTransferLeg,
  applyAutoTransfer,
  findAdoptableTransferLeg,
} from "@/lib/transactions";
import type { ParsedStatement } from "@/lib/import/types";

export type ActionState = { error?: string; success?: boolean };

export interface PreviewRow {
  date: string;
  amountCents: number;
  description: string;
  counterparty: string | null;
  bankReference: string | null;
  hash: string;
  categoryId: number | null;
  /** Set when an import rule targets a transfer instead of a category. */
  transferAccountId: number | null;
  transferAccountName: string | null;
  /** True when this row's date/amount matches an existing, not-yet-real
   *  transfer leg on this account (see applyAutoTransfer) — it will be merged
   *  into that leg instead of creating a new transaction. */
  isAdopted: boolean;
  isDuplicate: boolean;
}

export interface ImportPreview {
  accountId: number;
  accountName: string;
  filename: string;
  format: ImportFormat;
  rows: PreviewRow[];
  warnings: string[];
  /** CSV rows that couldn't be interpreted, with the per-row reason. */
  rejectedRows: CsvParseResult["rejectedRows"];
  duplicateCount: number;
  uncategorizedCount: number;
  closingBalanceCents: number | null;
  periodFrom: string | null;
  periodTo: string | null;
  /** Difference between the statement's closing balance and ours after import. */
  balanceDeltaCents: number | null;
}

async function readUpload(formData: FormData): Promise<{ file: File; text: string } | string> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return "Bitte eine Datei auswählen.";
  if (file.size > config.import.maxFileSizeBytes) {
    return `Die Datei ist grösser als ${Math.round(config.import.maxFileSizeBytes / 1024 / 1024)} MB.`;
  }
  return { file, text: await file.text() };
}

/**
 * Parses an uploaded statement and returns a preview without writing anything.
 *
 * Nothing is booked until the user has seen what would land in the ledger:
 * an import that silently creates two hundred rows is impossible to undo by
 * hand, and bank exports overlap and mis-map often enough that a review step
 * is not optional.
 */
export async function previewImportAction(
  _prevState: { error?: string; preview?: ImportPreview } | undefined,
  formData: FormData
): Promise<{ error?: string; preview?: ImportPreview }> {
  await requireEditor();

  const upload = await readUpload(formData);
  if (typeof upload === "string") return { error: upload };
  const { file, text } = upload;

  const format = formData.get("format") === "Csv" ? ImportFormat.Csv : ImportFormat.Camt053;

  let statement: ParsedStatement;
  let rejectedRows: CsvParseResult["rejectedRows"] = [];
  try {
    if (format === ImportFormat.Csv) {
      const mappingId = parseInt(String(formData.get("mappingId") ?? ""), 10);
      if (!Number.isInteger(mappingId)) return { error: "Bitte ein CSV-Mapping auswählen." };
      const mapping = await prisma.csvMapping.findUnique({ where: { id: mappingId } });
      if (!mapping) return { error: "CSV-Mapping nicht gefunden." };
      const csvResult = parseCsvStatement(text, mapping);
      statement = csvResult;
      rejectedRows = csvResult.rejectedRows;
    } else {
      statement = parseCamt053(text);
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Die Datei konnte nicht gelesen werden." };
  }

  // The account can be chosen explicitly, or matched from the statement's IBAN.
  const accountIdRaw = formData.get("accountId");
  let accountId = accountIdRaw ? parseInt(String(accountIdRaw), 10) : NaN;
  if (!Number.isInteger(accountId) && statement.iban) {
    const matched = await prisma.account.findUnique({ where: { iban: statement.iban } });
    if (matched) accountId = matched.id;
  }
  if (!Number.isInteger(accountId)) {
    return {
      error: statement.iban
        ? `Kein Konto mit der IBAN ${statement.iban} gefunden. Bitte das Zielkonto manuell wählen oder die IBAN am Konto hinterlegen.`
        : "Bitte das Zielkonto auswählen.",
    };
  }

  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return { error: "Konto nicht gefunden." };

  const hashed = withHashes(accountId, statement.transactions);
  const [existing, rules, adoptCandidates] = await Promise.all([
    prisma.transaction.findMany({
      where: { importHash: { in: hashed.map((row) => row.hash) } },
      select: { importHash: true },
    }),
    prisma.importRule.findMany({ where: { isActive: true } }),
    // Synthetic transfer legs on this account still waiting to be confirmed
    // by a real import (see lib/transactions.ts applyAutoTransfer).
    prisma.transaction.findMany({
      where: { accountId, importHash: null, transferGroupId: { not: null } },
      select: { id: true, date: true, amountCents: true },
    }),
  ]);
  const existingHashes = new Set(existing.map((row) => row.importHash));
  const transferAccountIds = [...new Set(rules.map((rule) => rule.transferAccountId).filter((id) => id !== null))];
  const transferAccounts = transferAccountIds.length
    ? await prisma.account.findMany({
        where: { id: { in: transferAccountIds } },
        select: { id: true, name: true },
      })
    : [];
  const transferAccountNames = new Map(transferAccounts.map((a) => [a.id, a.name]));

  const rows: PreviewRow[] = hashed.map((row) => {
    const isAdopted = adoptCandidates.some(
      (candidate) =>
        candidate.amountCents === row.amountCents &&
        candidate.date >= addDays(row.date, -TRANSFER_MATCH_TOLERANCE_DAYS) &&
        candidate.date <= addDays(row.date, TRANSFER_MATCH_TOLERANCE_DAYS)
    );
    const rule = isAdopted ? null : matchRule(rules, row);
    return {
      date: row.date,
      amountCents: row.amountCents,
      description: row.description,
      counterparty: row.counterparty,
      bankReference: row.bankReference,
      hash: row.hash,
      categoryId: rule?.categoryId ?? null,
      transferAccountId: rule?.transferAccountId ?? null,
      transferAccountName: rule?.transferAccountId
        ? (transferAccountNames.get(rule.transferAccountId) ?? null)
        : null,
      isAdopted,
      isDuplicate: existingHashes.has(row.hash),
    };
  });

  const fresh = rows.filter((row) => !row.isDuplicate);

  // Compare the statement's closing balance against what our balance would be
  // afterwards — the cheapest possible check that the import was complete.
  let balanceDeltaCents: number | null = null;
  if (statement.closingBalanceCents !== null && statement.periodTo) {
    const priorSum = await prisma.transaction.aggregate({
      where: { accountId, date: { lte: statement.periodTo } },
      _sum: { amountCents: true },
    });
    const projected =
      account.openingBalanceCents +
      (priorSum._sum.amountCents ?? 0) +
      fresh.reduce((sum, row) => sum + row.amountCents, 0);
    balanceDeltaCents = statement.closingBalanceCents - projected;
  }

  return {
    preview: {
      accountId,
      accountName: account.name,
      filename: file.name,
      format,
      rows,
      warnings: statement.warnings,
      rejectedRows,
      duplicateCount: rows.length - fresh.length,
      uncategorizedCount: fresh.filter(
        (row) => row.categoryId === null && row.transferAccountId === null && !row.isAdopted
      ).length,
      closingBalanceCents: statement.closingBalanceCents,
      periodFrom: statement.periodFrom,
      periodTo: statement.periodTo,
      balanceDeltaCents,
    },
  };
}

const commitRowSchema = z.object({
  date: z.string().refine(isValidDateString),
  amountCents: z.number().int(),
  description: z.string().max(500),
  counterparty: z.string().nullable(),
  bankReference: z.string().nullable(),
  hash: z.string().min(1),
  categoryId: z.number().int().nullable(),
  transferAccountId: z.number().int().nullable(),
});

const commitSchema = z.object({
  accountId: z.number().int(),
  filename: z.string().max(255),
  format: z.enum(ImportFormat),
  periodFrom: z.string().nullable(),
  periodTo: z.string().nullable(),
  closingBalanceCents: z.number().int().nullable(),
  rows: z.array(commitRowSchema).max(5000),
});

/**
 * Writes the reviewed rows. Anything whose hash already exists is skipped
 * again here, not just in the preview: the preview may be minutes old, and the
 * unique index on `importHash` is the only guarantee that survives a
 * concurrent import.
 */
export async function commitImportAction(
  payload: z.infer<typeof commitSchema>
): Promise<ActionState & { imported?: number; skipped?: number }> {
  const session = await requireEditor();

  const parsed = commitSchema.safeParse(payload);
  if (!parsed.success) return { error: "Ungültige Import-Daten." };
  const { accountId, rows, filename, format } = parsed.data;

  if (rows.length === 0) return { error: "Es wurden keine Buchungen zum Import ausgewählt." };

  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return { error: "Konto nicht gefunden." };

  const existing = await prisma.transaction.findMany({
    where: { importHash: { in: rows.map((row) => row.hash) } },
    select: { importHash: true },
  });
  const existingHashes = new Set(existing.map((row) => row.importHash));
  const fresh = rows.filter((row) => !existingHashes.has(row.hash));

  if (fresh.length === 0) {
    return { error: "Alle ausgewählten Buchungen sind bereits importiert." };
  }

  const userId = parseInt(session.user.id, 10);

  // The whole batch — including every row's adopt-or-create-and-transfer
  // decision — runs as one transaction: a mid-loop failure (DB error,
  // process kill) previously left a half-imported batch with no way back,
  // since the old bulk `createMany` gave that guarantee but a per-row loop
  // calling out to lib/transactions.ts (which needs to read state between
  // rows, e.g. whether an earlier row in this same batch already claimed a
  // synthetic transfer leg) does not, unless it's wrapped explicitly.
  const batch = await prisma.$transaction(async (tx) => {
    const created = await tx.importBatch.create({
      data: {
        filename,
        format,
        accountId,
        userId,
        importedCount: fresh.length,
        skippedCount: rows.length - fresh.length,
        statementBalanceCents: parsed.data.closingBalanceCents,
        periodFrom: parsed.data.periodFrom,
        periodTo: parsed.data.periodTo,
      },
    });

    // Each row may (a) adopt an existing synthetic transfer leg left behind
    // by an earlier auto-transfer on this account, (b) trigger a new
    // auto-transfer to another account, or (c) land as a plain, possibly
    // categorised booking — see lib/transactions.ts for what each does.
    for (const row of fresh) {
      const adoptable = await findAdoptableTransferLeg(tx, accountId, row.amountCents, row.date);
      if (adoptable) {
        await adoptTransferLeg(tx, adoptable.id, {
          date: row.date,
          description: row.description,
          counterparty: row.counterparty,
          bankReference: row.bankReference,
          importHash: row.hash,
          importBatchId: created.id,
        });
        continue;
      }

      const transaction = await tx.transaction.create({
        data: {
          date: row.date,
          amountCents: row.amountCents,
          accountId,
          categoryId: row.transferAccountId ? null : row.categoryId,
          description: row.description,
          counterparty: row.counterparty,
          bankReference: row.bankReference,
          importHash: row.hash,
          importBatchId: created.id,
          source: "Import" as const,
          createdById: userId,
        },
      });

      if (row.transferAccountId && row.transferAccountId !== accountId) {
        await applyAutoTransfer(tx, {
          transactionId: transaction.id,
          targetAccountId: row.transferAccountId,
        });
      }
    }

    return created;
  }, { timeout: 60_000 });

  await logAudit(session, "IMPORT", "Transaction", batch.id, {
    filename,
    imported: fresh.length,
    skipped: rows.length - fresh.length,
  });

  revalidatePath("/import");
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  revalidatePath("/budget");
  revalidatePath("/analytics");
  revalidatePath("/accounts");

  return { success: true, imported: fresh.length, skipped: rows.length - fresh.length };
}

/**
 * Removes every transaction of one import run. Statement imports are the one
 * operation that creates hundreds of rows at once, so undoing them by hand is
 * not realistic — this is the escape hatch for a wrong account or mapping.
 */
export async function deleteImportBatchAction(id: number): Promise<ActionState & { deleted?: number }> {
  const session = await requireEditor();

  const batch = await prisma.importBatch.findUnique({ where: { id } });
  if (!batch) return { error: "Import nicht gefunden." };

  // A row from this batch may be one leg of an auto-created transfer whose
  // counterpart (the synthetic leg, or a leg adopted from another batch) is
  // not itself part of this batch. Deleting only the batch's own rows would
  // leave that counterpart dangling, so every transfer group touched by this
  // batch is removed in full — same rule as deleteTransfer().
  const rows = await prisma.transaction.findMany({
    where: { importBatchId: id },
    select: { transferGroupId: true },
  });
  const transferGroupIds = [
    ...new Set(rows.map((row) => row.transferGroupId).filter((groupId): groupId is string => groupId !== null)),
  ];

  const { count } = await prisma.transaction.deleteMany({
    where: {
      OR: [{ importBatchId: id }, ...(transferGroupIds.length ? [{ transferGroupId: { in: transferGroupIds } }] : [])],
    },
  });
  await prisma.importBatch.delete({ where: { id } });

  await logAudit(session, "DELETE", "Transaction", id, {
    action: "deleteImportBatch",
    filename: batch.filename,
    deleted: count,
  });

  revalidatePath("/import");
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  revalidatePath("/accounts");
  return { success: true, deleted: count };
}

/** First rows of a CSV upload, for building a column mapping interactively. */
export async function inspectCsvAction(
  formData: FormData
): Promise<{ error?: string; rows?: string[][]; delimiter?: string }> {
  await requireEditor();

  const upload = await readUpload(formData);
  if (typeof upload === "string") return { error: upload };

  const delimiter = String(formData.get("delimiter") || "") || detectDelimiter(upload.text);
  return { rows: previewRows(upload.text, delimiter), delimiter };
}
