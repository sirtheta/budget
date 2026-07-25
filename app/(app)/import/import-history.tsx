"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import {
  deleteCsvMappingAction,
} from "./mapping-actions";
import { deleteImportBatchAction } from "./actions";
import { deleteImportRuleAction, toggleImportRuleAction } from "./rule-actions";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-dialog";

export function DeleteBatchButton({
  id,
  filename,
  count,
}: {
  id: number;
  filename: string;
  count: number;
}) {
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8 text-destructive"
      aria-label="Import rückgängig machen"
      disabled={pending}
      onClick={async () => {
        if (
          !(await confirm({
            description: `Import "${filename}" rückgängig machen? Die ${count} daraus entstandenen Buchungen werden gelöscht.`,
            confirmLabel: "Rückgängig machen",
          }))
        )
          return;
        startTransition(async () => {
          const result = await deleteImportBatchAction(id);
          if (result.error) toast.error(result.error);
          else toast.success(`${result.deleted} Buchung(en) entfernt.`);
        });
      }}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
}

export function DeleteMappingButton({ id, name }: { id: number; name: string }) {
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8 text-destructive"
      aria-label="Mapping löschen"
      disabled={pending}
      onClick={async () => {
        if (!(await confirm({ description: `Mapping "${name}" wirklich löschen?` }))) return;
        startTransition(async () => {
          const result = await deleteCsvMappingAction(id);
          if (result.error) toast.error(result.error);
          else toast.success("Mapping gelöscht.");
        });
      }}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
}

export function RuleToggle({ id, isActive }: { id: number; isActive: boolean }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await toggleImportRuleAction(id, !isActive);
          if (result.error) toast.error(result.error);
        })
      }
    >
      {isActive ? "Aktiv" : "Inaktiv"}
    </Button>
  );
}

export function DeleteRuleButton({ id, name }: { id: number; name: string }) {
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8 text-destructive"
      aria-label="Regel löschen"
      disabled={pending}
      onClick={async () => {
        if (!(await confirm({ description: `Regel "${name}" wirklich löschen?` }))) return;
        startTransition(async () => {
          const result = await deleteImportRuleAction(id);
          if (result.error) toast.error(result.error);
          else toast.success("Regel gelöscht.");
        });
      }}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
}
