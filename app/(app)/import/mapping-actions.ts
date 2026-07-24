"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { requireEditor } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { SUPPORTED_DATE_FORMATS } from "@/lib/import/csv";

export type ActionState = { error?: string; success?: boolean };

const columnSchema = z
  .string()
  .optional()
  .transform((value) => {
    if (value === undefined || value === "" || value === "none") return null;
    const parsed = parseInt(value, 10);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  });

const mappingSchema = z.object({
  name: z.string().trim().min(1, "Name darf nicht leer sein.").max(60),
  delimiter: z.string().min(1).max(4),
  skipRows: z.coerce.number().int().min(0).max(50),
  hasHeader: z.boolean(),
  dateColumn: z.coerce.number().int().min(0),
  dateFormat: z.string().refine((value) => SUPPORTED_DATE_FORMATS.includes(value), {
    message: "Nicht unterstütztes Datumsformat.",
  }),
  descriptionColumn: z.coerce.number().int().min(0),
  decimalSeparator: z.string().min(1).max(1),
  thousandsSeparator: z.string().max(1),
});

export async function saveCsvMappingAction(
  _prevState: ActionState | undefined,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();

  const parsed = mappingSchema.safeParse({
    name: formData.get("name") ?? "",
    delimiter: formData.get("delimiter") ?? ";",
    skipRows: formData.get("skipRows") ?? 0,
    hasHeader: formData.get("hasHeader") === "on",
    dateColumn: formData.get("dateColumn") ?? 0,
    dateFormat: formData.get("dateFormat") ?? "DD.MM.YYYY",
    descriptionColumn: formData.get("descriptionColumn") ?? 1,
    decimalSeparator: formData.get("decimalSeparator") ?? ".",
    thousandsSeparator: formData.get("thousandsSeparator") ?? "'",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };

  const amountColumn = columnSchema.parse(formData.get("amountColumn") as string | undefined);
  const debitColumn = columnSchema.parse(formData.get("debitColumn") as string | undefined);
  const creditColumn = columnSchema.parse(formData.get("creditColumn") as string | undefined);
  const counterpartyColumn = columnSchema.parse(
    formData.get("counterpartyColumn") as string | undefined
  );

  // Either one signed column or a debit/credit pair — without one of them the
  // parser has no amount to read.
  if (amountColumn === null && debitColumn === null && creditColumn === null) {
    return {
      error: "Bitte entweder eine Betragsspalte oder Soll-/Haben-Spalten angeben.",
    };
  }

  const data = {
    ...parsed.data,
    amountColumn,
    debitColumn,
    creditColumn,
    counterpartyColumn,
  };

  const idRaw = formData.get("id");
  const id = idRaw ? parseInt(String(idRaw), 10) : null;

  try {
    if (id) {
      await prisma.csvMapping.update({ where: { id }, data });
      await logAudit(session, "UPDATE", "CsvMapping", id, { name: data.name });
    } else {
      const created = await prisma.csvMapping.create({ data });
      await logAudit(session, "CREATE", "CsvMapping", created.id, { name: data.name });
    }
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      return { error: "Ein Mapping mit diesem Namen existiert bereits." };
    }
    throw err;
  }

  revalidatePath("/import");
  return { success: true };
}

export async function deleteCsvMappingAction(id: number): Promise<ActionState> {
  const session = await requireEditor();
  const mapping = await prisma.csvMapping.delete({ where: { id } });
  await logAudit(session, "DELETE", "CsvMapping", id, { name: mapping.name });
  revalidatePath("/import");
  return { success: true };
}
