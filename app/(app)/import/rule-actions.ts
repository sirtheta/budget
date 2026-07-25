"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { RuleField, RuleMatch } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireEditor } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { matchRule } from "@/lib/import/rules";
import { applyAutoTransfer } from "@/lib/transactions";
import { seedDefaultImportRules } from "@/lib/import/default-rules";
import { parseMoney } from "@/lib/money";

export type ActionState = { error?: string; success?: boolean };

const ruleSchema = z
  .object({
    name: z.string().trim().min(1, "Name darf nicht leer sein.").max(80),
    field: z.enum(RuleField),
    matchType: z.enum(RuleMatch),
    pattern: z.string().trim().min(1, "Suchmuster darf nicht leer sein.").max(200),
    categoryId: z.coerce.number().int().nullable(),
    transferAccountId: z.coerce.number().int().nullable(),
    minAmountCents: z.number().int().min(0).nullable(),
    maxAmountCents: z.number().int().min(0).nullable(),
    priority: z.coerce.number().int().min(0).max(999),
  })
  // A rule either auto-categorises or auto-transfers, never both — mirrors
  // the schema comment on ImportRule.
  .refine((data) => (data.categoryId === null) !== (data.transferAccountId === null), {
    message: "Bitte entweder eine Kategorie oder ein Umbuchungs-Konto wählen.",
  })
  .refine(
    (data) =>
      data.minAmountCents === null || data.maxAmountCents === null || data.minAmountCents <= data.maxAmountCents,
    { message: "Mindestbetrag darf nicht grösser als Maximalbetrag sein." }
  );

/** Parses an optional CHF amount field into absolute Rappen; empty means "no bound". */
function parseOptionalAmount(raw: FormDataEntryValue | null): number | null | "invalid" {
  const str = String(raw ?? "").trim();
  if (!str) return null;
  const cents = parseMoney(str);
  return cents === null ? "invalid" : Math.abs(cents);
}

export async function saveImportRuleAction(
  _prevState: ActionState | undefined,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();

  const categoryIdRaw = formData.get("categoryId");
  const transferAccountIdRaw = formData.get("transferAccountId");
  const minAmountCents = parseOptionalAmount(formData.get("minAmount"));
  if (minAmountCents === "invalid") return { error: "Mindestbetrag ist keine gültige Zahl." };
  const maxAmountCents = parseOptionalAmount(formData.get("maxAmount"));
  if (maxAmountCents === "invalid") return { error: "Maximalbetrag ist keine gültige Zahl." };

  const parsed = ruleSchema.safeParse({
    name: formData.get("name") ?? "",
    field: formData.get("field") ?? "Description",
    matchType: formData.get("matchType") ?? "Contains",
    pattern: formData.get("pattern") ?? "",
    categoryId: categoryIdRaw ? categoryIdRaw : null,
    transferAccountId: transferAccountIdRaw ? transferAccountIdRaw : null,
    minAmountCents,
    maxAmountCents,
    priority: formData.get("priority") ?? 0,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };

  // An invalid regex would silently never match, so it is rejected at save
  // time rather than quietly doing nothing during every future import.
  if (parsed.data.matchType === "Regex") {
    try {
      new RegExp(parsed.data.pattern);
    } catch (err) {
      return {
        error: `Ungültiger regulärer Ausdruck: ${err instanceof Error ? err.message : "Syntaxfehler"}`,
      };
    }
  }

  if (parsed.data.categoryId !== null) {
    const category = await prisma.category.findUnique({ where: { id: parsed.data.categoryId } });
    if (!category) return { error: "Kategorie nicht gefunden." };
  } else {
    const account = await prisma.account.findUnique({ where: { id: parsed.data.transferAccountId! } });
    if (!account) return { error: "Umbuchungs-Konto nicht gefunden." };
  }

  const idRaw = formData.get("id");
  const id = idRaw ? parseInt(String(idRaw), 10) : null;

  if (id) {
    await prisma.importRule.update({ where: { id }, data: parsed.data });
    await logAudit(session, "UPDATE", "ImportRule", id, { name: parsed.data.name });
  } else {
    const created = await prisma.importRule.create({ data: parsed.data });
    await logAudit(session, "CREATE", "ImportRule", created.id, { name: parsed.data.name });
  }

  revalidatePath("/import");
  return { success: true };
}

export async function deleteImportRuleAction(id: number): Promise<ActionState> {
  const session = await requireEditor();
  const rule = await prisma.importRule.delete({ where: { id } });
  await logAudit(session, "DELETE", "ImportRule", id, { name: rule.name });
  revalidatePath("/import");
  return { success: true };
}

export async function toggleImportRuleAction(id: number, isActive: boolean): Promise<ActionState> {
  const session = await requireEditor();
  const rule = await prisma.importRule.update({ where: { id }, data: { isActive } });
  await logAudit(session, "UPDATE", "ImportRule", id, { name: rule.name, isActive });
  revalidatePath("/import");
  return { success: true };
}

/**
 * Applies the current rules to transactions that are still uncategorised.
 *
 * Rules only run during import, so a rule added afterwards would otherwise
 * never reach the bookings that prompted it. Only untouched rows are
 * considered — a manual categorisation is never overwritten.
 */
export async function applyRulesToUncategorizedAction(): Promise<
  ActionState & { updated?: number }
> {
  const session = await requireEditor();

  const [rules, pending] = await Promise.all([
    prisma.importRule.findMany({ where: { isActive: true } }),
    prisma.transaction.findMany({
      where: { categoryId: null, transferGroupId: null },
      select: {
        id: true,
        accountId: true,
        description: true,
        counterparty: true,
        amountCents: true,
        date: true,
      },
    }),
  ]);

  if (rules.length === 0) return { error: "Es sind keine aktiven Regeln vorhanden." };

  const categories = await prisma.category.findMany({ select: { id: true, kind: true } });
  const kindById = new Map(categories.map((category) => [category.id, category.kind]));

  let updated = 0;
  for (const transaction of pending) {
    const rule = matchRule(rules, {
      date: transaction.date,
      amountCents: transaction.amountCents,
      description: transaction.description,
      counterparty: transaction.counterparty,
      bankReference: null,
    });
    if (!rule) continue;

    if (rule.transferAccountId !== null) {
      if (rule.transferAccountId === transaction.accountId) continue;
      await applyAutoTransfer(prisma, {
        transactionId: transaction.id,
        targetAccountId: rule.transferAccountId,
      });
      updated++;
      continue;
    }

    const categoryId = rule.categoryId;
    if (categoryId === null) continue;

    // Same guard as the booking form: an expense must not land in an income
    // category, even when a sloppy rule says so.
    const kind = kindById.get(categoryId);
    if (kind === "Income" && transaction.amountCents < 0) continue;
    if (kind === "Expense" && transaction.amountCents > 0) continue;

    await prisma.transaction.update({ where: { id: transaction.id }, data: { categoryId } });
    updated++;
  }

  await logAudit(session, "UPDATE", "Transaction", undefined, {
    action: "applyRulesToUncategorized",
    updated,
  });

  revalidatePath("/import");
  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/dashboard");
  return { success: true, updated };
}

/** Creates the Swiss starter rule set; skips patterns and categories already covered. */
export async function seedDefaultImportRulesAction(): Promise<
  ActionState & { created?: number }
> {
  const session = await requireEditor();
  const { created, skipped } = await seedDefaultImportRules(prisma);
  await logAudit(session, "CREATE", "ImportRule", undefined, {
    action: "seedDefaults",
    created,
    skipped,
  });
  revalidatePath("/import");
  return { success: true, created };
}
