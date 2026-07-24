"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CategoryKind } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireEditor } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { seedDefaultCategories } from "@/lib/categories";

export type ActionState = { error?: string; success?: boolean };

const categorySchema = z.object({
  name: z.string().trim().min(1, "Name darf nicht leer sein.").max(60),
  kind: z.enum(CategoryKind),
  parentId: z.number().int().nullable(),
  color: z.string().trim().max(20).nullable(),
});

export async function saveCategoryAction(
  _prevState: ActionState | undefined,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();

  const parentRaw = formData.get("parentId");
  const parentId = parentRaw && parentRaw !== "" ? parseInt(String(parentRaw), 10) : null;

  const parsed = categorySchema.safeParse({
    name: formData.get("name") ?? "",
    kind: formData.get("kind") ?? "Expense",
    parentId,
    color: (formData.get("color") as string) || null,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };

  const idRaw = formData.get("id");
  const id = idRaw ? parseInt(String(idRaw), 10) : null;

  if (parentId !== null) {
    const parent = await prisma.category.findUnique({ where: { id: parentId } });
    if (!parent) return { error: "Übergeordnete Kategorie nicht gefunden." };
    // Two levels is the whole model — a deeper tree would make every budget
    // roll-up ambiguous, so it is rejected rather than silently flattened.
    if (parent.parentId !== null) {
      return { error: "Kategorien können nur zwei Ebenen tief sein." };
    }
    if (id !== null && parentId === id) {
      return { error: "Eine Kategorie kann sich nicht selbst übergeordnet sein." };
    }
  }

  const duplicate = await prisma.category.findFirst({
    where: {
      name: parsed.data.name,
      parentId: parsed.data.parentId,
      ...(id ? { id: { not: id } } : {}),
    },
  });
  if (duplicate) return { error: "Auf dieser Ebene existiert bereits eine Kategorie mit diesem Namen." };

  if (id) {
    // Moving a category between Income and Expense would flip the sign
    // interpretation of every transaction already booked on it.
    const existing = await prisma.category.findUnique({
      where: { id },
      select: { kind: true, _count: { select: { transactions: true } } },
    });
    if (existing && existing.kind !== parsed.data.kind && existing._count.transactions > 0) {
      return {
        error: `Die Art kann nicht geändert werden, solange ${existing._count.transactions} Buchung(en) auf dieser Kategorie liegen.`,
      };
    }
    await prisma.category.update({ where: { id }, data: parsed.data });
    await logAudit(session, "UPDATE", "Category", id, { name: parsed.data.name });
  } else {
    const last = await prisma.category.findFirst({
      where: { parentId: parsed.data.parentId },
      orderBy: { sortOrder: "desc" },
    });
    const created = await prisma.category.create({
      data: { ...parsed.data, sortOrder: (last?.sortOrder ?? -1) + 1 },
    });
    await logAudit(session, "CREATE", "Category", created.id, { name: parsed.data.name });
  }

  revalidatePath("/categories");
  revalidatePath("/budget");
  return { success: true };
}

export async function toggleCategoryActiveAction(
  id: number,
  isActive: boolean
): Promise<ActionState> {
  const session = await requireEditor();
  const category = await prisma.category.update({ where: { id }, data: { isActive } });
  await logAudit(session, "UPDATE", "Category", id, { name: category.name, isActive });
  revalidatePath("/categories");
  revalidatePath("/budget");
  return { success: true };
}

/**
 * Deletes a category. Refused while transactions or sub-categories hang off
 * it: the schema cascades children away and nulls the category on
 * transactions, which would quietly strip months of classification.
 */
export async function deleteCategoryAction(id: number): Promise<ActionState> {
  const session = await requireEditor();

  const [transactionCount, childCount] = await Promise.all([
    prisma.transaction.count({ where: { categoryId: id } }),
    prisma.category.count({ where: { parentId: id } }),
  ]);
  if (childCount > 0) {
    return { error: `Kategorie hat ${childCount} Unterkategorie(n). Bitte diese zuerst löschen.` };
  }
  if (transactionCount > 0) {
    return {
      error: `Kategorie wird von ${transactionCount} Buchung(en) verwendet. Bitte stattdessen deaktivieren.`,
    };
  }

  const category = await prisma.category.delete({ where: { id } });
  await logAudit(session, "DELETE", "Category", id, { name: category.name });
  revalidatePath("/categories");
  revalidatePath("/budget");
  return { success: true };
}

/** Creates the default Swiss household tree; skips anything already present. */
export async function seedDefaultCategoriesAction(): Promise<ActionState & { created?: number }> {
  const session = await requireEditor();
  const created = await seedDefaultCategories(prisma);
  await logAudit(session, "CREATE", "Category", undefined, { action: "seedDefaults", created });
  revalidatePath("/categories");
  revalidatePath("/budget");
  return { success: true, created };
}
