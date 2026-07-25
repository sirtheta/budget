"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AccountType } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireEditor } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { parseMoney } from "@/lib/money";

export type ActionState = { error?: string; success?: boolean };

const accountSchema = z.object({
  name: z.string().trim().min(1, "Name darf nicht leer sein.").max(80),
  type: z.enum(AccountType),
  iban: z
    .string()
    .trim()
    .transform((value) => value.replace(/\s+/g, "").toUpperCase())
    .refine((value) => value === "" || /^CH\d{2}[A-Z0-9]{12,30}$/.test(value), {
      message: "IBAN sieht nicht wie eine gültige Schweizer IBAN aus.",
    })
    .transform((value) => value || null),
  openingBalance: z.string(),
  btcAmount: z.string(),
  color: z.string().trim().max(20).optional(),
  excludeFromBudget: z.boolean(),
  notes: z.string().trim().max(500).optional(),
});

function readForm(formData: FormData) {
  return accountSchema.safeParse({
    name: formData.get("name") ?? "",
    type: formData.get("type") ?? "Checking",
    iban: formData.get("iban") ?? "",
    openingBalance: String(formData.get("openingBalance") ?? "0"),
    btcAmount: String(formData.get("btcAmount") ?? "0"),
    color: formData.get("color") ?? undefined,
    excludeFromBudget: formData.get("excludeFromBudget") === "on",
    notes: formData.get("notes") ?? undefined,
  });
}

export async function saveAccountAction(
  _prevState: ActionState | undefined,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();

  const parsed = readForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };

  const isCrypto = parsed.data.type === "Crypto";

  let openingBalanceCents = 0;
  let btcAmount: number | null = null;
  let iban: string | null = parsed.data.iban;

  if (isCrypto) {
    const raw = parsed.data.btcAmount.trim().replace(",", ".");
    btcAmount = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(btcAmount) || btcAmount < 0) {
      return { error: "BTC-Bestand ist keine gültige Zahl." };
    }
    iban = null; // crypto wallets don't have one, and IBAN is unique
  } else {
    const cents = parseMoney(parsed.data.openingBalance || "0");
    if (cents === null) return { error: "Startsaldo ist keine gültige Zahl." };
    openingBalanceCents = cents;
  }

  const idRaw = formData.get("id");
  const id = idRaw ? parseInt(String(idRaw), 10) : null;

  const data = {
    name: parsed.data.name,
    type: parsed.data.type,
    iban,
    openingBalanceCents,
    btcAmount,
    color: parsed.data.color || null,
    excludeFromBudget: parsed.data.excludeFromBudget,
    notes: parsed.data.notes || null,
  };

  try {
    if (id) {
      await prisma.account.update({ where: { id }, data });
      await logAudit(session, "UPDATE", "Account", id, { name: data.name });
    } else {
      const created = await prisma.account.create({
        data: { ...data, sortOrder: await nextSortOrder() },
      });
      await logAudit(session, "CREATE", "Account", created.id, { name: data.name });
    }
  } catch (err) {
    // The IBAN is unique so a statement can be matched to exactly one account;
    // report the collision rather than the raw Prisma error.
    if (isUniqueViolation(err)) {
      return { error: "Diese IBAN ist bereits einem anderen Konto zugeordnet." };
    }
    throw err;
  }

  revalidatePath("/accounts");
  revalidatePath("/dashboard");
  return { success: true };
}

async function nextSortOrder(): Promise<number> {
  const last = await prisma.account.findFirst({ orderBy: { sortOrder: "desc" } });
  return (last?.sortOrder ?? -1) + 1;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}

export async function toggleAccountActiveAction(id: number, isActive: boolean): Promise<ActionState> {
  const session = await requireEditor();
  const account = await prisma.account.update({ where: { id }, data: { isActive } });
  await logAudit(session, "UPDATE", "Account", id, { name: account.name, isActive });
  revalidatePath("/accounts");
  revalidatePath("/dashboard");
  return { success: true };
}

/**
 * Deletes an account. Refused while it still holds transactions — deleting
 * would cascade them away and silently rewrite months of history. Deactivating
 * is offered instead, which hides the account without losing anything.
 */
export async function deleteAccountAction(id: number): Promise<ActionState> {
  const session = await requireEditor();

  const count = await prisma.transaction.count({ where: { accountId: id } });
  if (count > 0) {
    return {
      error: `Konto hat ${count} Buchung(en) und kann nicht gelöscht werden. Bitte stattdessen deaktivieren.`,
    };
  }

  const account = await prisma.account.delete({ where: { id } });
  await logAudit(session, "DELETE", "Account", id, { name: account.name });
  revalidatePath("/accounts");
  revalidatePath("/dashboard");
  return { success: true };
}
