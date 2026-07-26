"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { UserListItem } from "./types";
import { deleteUserAction, toggleUserActiveAction } from "./actions";
import { UserFormDialog } from "./user-form-dialog";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserRowActions({ user, isSelf }: { user: UserListItem; isSelf: boolean }) {
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();

  const run = (fn: () => Promise<{ error?: string }>, success: string) =>
    startTransition(async () => {
      const result = await fn();
      if (result.error) toast.error(result.error);
      else toast.success(success);
    });

  return (
    <div className="flex justify-end">
      <UserFormDialog
        user={user}
        trigger={
          <Button variant="ghost" size="icon" aria-label="Benutzer bearbeiten">
            <Pencil className="h-4 w-4" />
          </Button>
        }
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Weitere Aktionen"
            disabled={pending || isSelf}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() =>
              run(
                () => toggleUserActiveAction(user.id, !user.isActive),
                user.isActive ? "Benutzer deaktiviert." : "Benutzer aktiviert."
              )
            }
          >
            {user.isActive ? (
              <>
                <EyeOff className="mr-2 h-4 w-4" /> Deaktivieren
              </>
            ) : (
              <>
                <Eye className="mr-2 h-4 w-4" /> Aktivieren
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive"
            onSelect={async () => {
              if (!(await confirm({ description: `Benutzer "${user.name}" wirklich löschen?` }))) return;
              run(() => deleteUserAction(user.id), "Benutzer gelöscht.");
            }}
          >
            <Trash2 className="mr-2 h-4 w-4" /> Löschen
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
