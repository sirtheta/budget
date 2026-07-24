"use client";

import { useState } from "react";
import type { Category } from "@prisma/client";
import { CategoryKind } from "@prisma/client";
import { saveCategoryAction } from "./actions";
import { useDialogFormAction } from "@/components/use-dialog-form";
import { CATEGORY_KIND_LABELS } from "@/lib/categories";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NO_PARENT = "none";

export function CategoryFormDialog({
  category,
  parents,
  defaultParentId,
  defaultKind,
  trigger,
}: {
  category?: Category;
  /** Top-level categories available as a parent. */
  parents: Pick<Category, "id" | "name" | "kind" | "color">[];
  defaultParentId?: number | null;
  defaultKind?: CategoryKind;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useDialogFormAction(saveCategoryAction, {
    onSuccess: () => setOpen(false),
    successMessage: category ? "Kategorie gespeichert." : "Kategorie angelegt.",
  });
  // Radix Select rejects an empty string as an item value, so "no parent" gets
  // its own sentinel and is mapped back to "" for the form field.
  const [parentId, setParentId] = useState<string>(
    String(category?.parentId ?? defaultParentId ?? NO_PARENT)
  );
  const [kind, setKind] = useState<CategoryKind>(
    category?.kind ?? defaultKind ?? "Expense"
  );

  // A sub-category always belongs to its parent's side of the ledger; letting
  // the two disagree would put an expense inside an income group.
  const selectedParent = parents.find((p) => String(p.id) === parentId);
  const effectiveKind = selectedParent?.kind ?? kind;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{category ? "Kategorie bearbeiten" : "Neue Kategorie"}</DialogTitle>
          <DialogDescription>
            Gebucht wird immer auf der untersten Ebene. Eine Gruppe ohne Unterkategorien kann
            selbst bebucht werden.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4">
          {category && <input type="hidden" name="id" value={category.id} />}
          <input
            type="hidden"
            name="parentId"
            value={parentId === NO_PARENT ? "" : parentId}
          />
          <input type="hidden" name="kind" value={effectiveKind} />

          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" defaultValue={category?.name} required autoFocus />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="parent-trigger">Übergeordnete Gruppe</Label>
            <Select value={parentId} onValueChange={setParentId}>
              <SelectTrigger id="parent-trigger">
                <SelectValue placeholder="Keine (eigene Gruppe)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PARENT}>Keine (eigene Gruppe)</SelectItem>
                {parents
                  .filter((p) => p.id !== category?.id)
                  .map((parent) => (
                    <SelectItem key={parent.id} value={String(parent.id)}>
                      {parent.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="kind-trigger">Art</Label>
              <Select
                value={effectiveKind}
                onValueChange={(value) => setKind(value as CategoryKind)}
                disabled={!!selectedParent}
              >
                <SelectTrigger id="kind-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(CategoryKind).map((value) => (
                    <SelectItem key={value} value={value}>
                      {CATEGORY_KIND_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedParent && (
                <p className="text-xs text-muted-foreground">
                  Wird von der Gruppe übernommen.
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="color">Farbe</Label>
              <Input
                id="color"
                name="color"
                type="color"
                defaultValue={category?.color ?? selectedParent?.color ?? "#6366f1"}
                className="h-9 p-1"
              />
            </div>
          </div>

          {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Speichern…" : "Speichern"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
