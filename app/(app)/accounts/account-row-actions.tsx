"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, MoreHorizontal, Trash2 } from "lucide-react";
import type { Account } from "@prisma/client";
import { deleteAccountAction, toggleAccountActiveAction } from "./actions";
import { AccountFormDialog } from "./account-form-dialog";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function AccountRowActions({ account }: { account: Account }) {
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();

  const toggleActive = () => {
    startTransition(async () => {
      const result = await toggleAccountActiveAction(account.id, !account.isActive);
      if (result.error) toast.error(result.error);
      else toast.success(account.isActive ? "Konto deaktiviert." : "Konto aktiviert.");
    });
  };

  const remove = async () => {
    if (!(await confirm({ description: `Konto "${account.name}" wirklich löschen?` }))) return;
    startTransition(async () => {
      const result = await deleteAccountAction(account.id);
      if (result.error) toast.error(result.error);
      else toast.success("Konto gelöscht.");
    });
  };

  return (
    <div className="flex justify-end">
      <AccountFormDialog account={account} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Weitere Aktionen" disabled={pending}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={toggleActive}>
            {account.isActive ? (
              <>
                <EyeOff className="mr-2 h-4 w-4" /> Deaktivieren
              </>
            ) : (
              <>
                <Eye className="mr-2 h-4 w-4" /> Aktivieren
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={remove} className="text-destructive">
            <Trash2 className="mr-2 h-4 w-4" /> Löschen
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
