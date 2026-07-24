"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import type { Transaction } from "@prisma/client";
import { deleteTransactionAction } from "./actions";
import { TransactionFormDialog, type AccountOption } from "./transaction-form-dialog";
import type { CategoryOption } from "@/lib/categories";
import { Button } from "@/components/ui/button";

export function TransactionRowActions({
  transaction,
  accounts,
  categories,
  today,
}: {
  transaction: Transaction;
  accounts: AccountOption[];
  categories: CategoryOption[];
  today: string;
}) {
  const [pending, startTransition] = useTransition();

  const remove = () => {
    const message = transaction.transferGroupId
      ? "Umbuchung löschen? Beide Seiten werden entfernt."
      : `Buchung "${transaction.description}" wirklich löschen?`;
    if (!confirm(message)) return;
    startTransition(async () => {
      const result = await deleteTransactionAction(transaction.id);
      if (result.error) toast.error(result.error);
      else toast.success("Buchung gelöscht.");
    });
  };

  return (
    <div className="flex justify-end opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
      <TransactionFormDialog
        transaction={transaction}
        accounts={accounts}
        categories={categories}
        today={today}
        trigger={
          <Button variant="ghost" size="icon" className="size-8" aria-label="Buchung bearbeiten">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        }
      />
      <Button
        variant="ghost"
        size="icon"
        className="size-8 text-destructive"
        aria-label="Buchung löschen"
        onClick={remove}
        disabled={pending}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
