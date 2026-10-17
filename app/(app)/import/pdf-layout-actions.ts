"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { requireEditor } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { seedDefaultPdfLayouts } from "@/lib/import/default-mappings";
import {
  analyzePdf,
  parseContextRules,
  validateLayout,
  type LineKind,
  type PdfParseResult,
} from "@/lib/import/pdf-parse";
import { RegexTimeoutError, createSafeMatcher } from "@/lib/import/safe-regex";
import logger from "@/lib/logger";

const log = logger.child({ module: "import" });

export type ActionState = { error?: string; success?: boolean };

const optionalText = z
  .string()
  .max(2000)
  .transform((value) => value.trim() || null);

const layoutSchema = z.object({
  name: z.string().trim().min(1, "Name darf nicht leer sein.").max(60),
  transactionRegex: z.string().trim().min(1, "Buchungszeilen-Regex darf nicht leer sein.").max(2000),
  dateFormat: z.string(),
  negativeSuffixRegex: optionalText,
  invertAmount: z.boolean(),
  descriptionTemplate: z.string().trim().max(200),
  skipRegex: optionalText,
  totalRegex: optionalText,
  contextRegexes: z.string().max(10_000),
});

export async function savePdfLayoutAction(
  _prevState: ActionState | undefined,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();

  const parsed = layoutSchema.safeParse({
    name: formData.get("name") ?? "",
    transactionRegex: formData.get("transactionRegex") ?? "",
    dateFormat: formData.get("dateFormat") ?? "DD.MM.YY",
    negativeSuffixRegex: formData.get("negativeSuffixRegex") ?? "",
    invertAmount: formData.get("invertAmount") === "on",
    descriptionTemplate: formData.get("descriptionTemplate") || "{text}",
    skipRegex: formData.get("skipRegex") ?? "",
    totalRegex: formData.get("totalRegex") ?? "",
    contextRegexes: formData.get("contextRegexes") ?? "[]",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };

  // The stored string must round-trip: a rule list that parses to something
  // shorter than what was submitted would silently lose rules.
  let submittedRules: unknown;
  try {
    submittedRules = JSON.parse(parsed.data.contextRegexes);
  } catch {
    return { error: "Kontext-Regeln sind ungültig." };
  }
  const rules = parseContextRules(parsed.data.contextRegexes);
  if (!Array.isArray(submittedRules) || rules.length !== submittedRules.length) {
    return { error: "Kontext-Regeln sind ungültig." };
  }

  const problem = validateLayout({
    transactionRegex: parsed.data.transactionRegex,
    dateFormat: parsed.data.dateFormat,
    negativeSuffixRegex: parsed.data.negativeSuffixRegex,
    invertAmount: parsed.data.invertAmount,
    descriptionTemplate: parsed.data.descriptionTemplate,
    skipRegex: parsed.data.skipRegex,
    totalRegex: parsed.data.totalRegex,
    contextRules: rules,
  });
  if (problem) return { error: problem };

  const data = { ...parsed.data, contextRegexes: JSON.stringify(rules) };

  const idRaw = formData.get("id");
  const id = idRaw ? parseInt(String(idRaw), 10) : null;

  try {
    if (id) {
      await prisma.pdfLayout.update({ where: { id }, data });
      await logAudit(session, "UPDATE", "PdfLayout", id, { name: data.name });
    } else {
      const created = await prisma.pdfLayout.create({ data });
      await logAudit(session, "CREATE", "PdfLayout", created.id, { name: data.name });
    }
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002") {
      return { error: "Ein Layout mit diesem Namen existiert bereits." };
    }
    throw err;
  }

  revalidatePath("/import");
  return { success: true };
}

export async function deletePdfLayoutAction(id: number): Promise<ActionState> {
  const session = await requireEditor();
  const layout = await prisma.pdfLayout.delete({ where: { id } });
  await logAudit(session, "DELETE", "PdfLayout", id, { name: layout.name });
  revalidatePath("/import");
  return { success: true };
}

const previewSchema = z.object({
  lines: z.array(z.string().max(2000)).max(2000),
  layout: z.object({
    transactionRegex: z.string().max(2000),
    dateFormat: z.string().max(20),
    negativeSuffixRegex: z.string().max(2000).nullable(),
    invertAmount: z.boolean(),
    descriptionTemplate: z.string().max(200),
    skipRegex: z.string().max(2000).nullable(),
    totalRegex: z.string().max(2000).nullable(),
    contextRules: z
      .array(z.object({ regex: z.string().max(2000), target: z.enum(["section", "transaction"]) }))
      .max(20),
  }),
});

/**
 * Live preview of an unsaved layout against sample lines, for the layout
 * dialog. Runs on the server so the regexes get the same hard timeouts as a real
 * import — a half-typed pattern must not be able to freeze anything.
 */
export async function previewPdfLayoutAction(
  input: unknown
): Promise<{ error?: string; kinds?: LineKind[]; result?: PdfParseResult }> {
  await requireEditor();

  const parsed = previewSchema.safeParse(input);
  if (!parsed.success) return { error: "Ungültige Vorschau-Daten." };
  const { lines, layout } = parsed.data;

  const problem = validateLayout(layout);
  if (problem) return { error: problem };

  try {
    return analyzePdf(lines, layout, createSafeMatcher());
  } catch (err) {
    if (err instanceof RegexTimeoutError) return { error: err.message };
    log.warn({ err }, "PDF layout preview failed");
    return { error: "Die Vorschau konnte nicht berechnet werden." };
  }
}

/** Creates the starter PDF layouts (Migros Kreditkarte); skips names already taken. */
export async function seedDefaultPdfLayoutsAction(): Promise<ActionState & { created?: number }> {
  const session = await requireEditor();
  const { created, skipped } = await seedDefaultPdfLayouts(prisma);
  await logAudit(session, "CREATE", "PdfLayout", undefined, { action: "seedDefaults", created, skipped });
  revalidatePath("/import");
  return { success: true, created };
}
