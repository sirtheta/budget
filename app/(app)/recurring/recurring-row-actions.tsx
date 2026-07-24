"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { MoreHorizontal, Pause, Pencil, Play, PlayCircle, Trash2 } from "lucide-react";
import type { RecurringTransaction } from "@prisma/client";
import {
  deleteRecurringAction,
  postRecurringNowAction,
  runRecurringNowAction,
  toggleRecurringActiveAction,
} from "./actions";
import { RecurringFormDialog } from "./recurring-form-dialog";
import type { CategoryOption } from "@/lib/categories";
import type { AccountOption } from "@/app/(app)/transactions/transaction-form-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function RecurringRowActions({
  recurring,
  accounts,
  categories,
  today,
}: {
  recurring: RecurringTransaction;
  accounts: AccountOption[];
  categories: CategoryOption[];
  today: string;
}) {
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ error?: string }>, success: string) =>
    startTransition(async () => {
      const result = await fn();
      if (result.error) toast.error(result.error);
      else toast.success(success);
    });

  return (
    <div className="flex justify-end">
      <RecurringFormDialog
        recurring={recurring}
        accounts={accounts}
        categories={categories}
        today={today}
        trigger={
          <Button variant="ghost" size="icon" aria-label="Bearbeiten">
            <Pencil className="h-4 w-4" />
          </Button>
        }
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Weitere Aktionen" disabled={pending}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {recurring.nextDate <= today && recurring.isActive && (
            <DropdownMenuItem
              onSelect={() =>
                run(() => postRecurringNowAction(recurring.id), "Buchung erfasst.")
              }
            >
              <PlayCircle className="mr-2 h-4 w-4" /> Jetzt buchen
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={() =>
              run(
                () => toggleRecurringActiveAction(recurring.id, !recurring.isActive),
                recurring.isActive ? "Pausiert." : "Aktiviert."
              )
            }
          >
            {recurring.isActive ? (
              <>
                <Pause className="mr-2 h-4 w-4" /> Pausieren
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" /> Aktivieren
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive"
            onSelect={() => {
              if (!confirm(`"${recurring.name}" wirklich löschen?`)) return;
              run(() => deleteRecurringAction(recurring.id), "Gelöscht.");
            }}
          >
            <Trash2 className="mr-2 h-4 w-4" /> Löschen
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Runs the scheduler on demand, e.g. after the container was switched off. */
export function RunNowButton() {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await runRecurringNowAction();
          if (result.error) toast.error(result.error);
          else if (result.posted === 0) toast.info("Es ist nichts fällig.");
          else toast.success(`${result.posted} Buchung(en) erfasst.`);
        })
      }
    >
      <PlayCircle className="h-4 w-4" />
      {pending ? "Prüfen…" : "Fällige jetzt buchen"}
    </Button>
  );
}
