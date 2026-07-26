"use client";

import { useState } from "react";
import { UserRole } from "@prisma/client";
import type { UserListItem } from "./types";
import { saveUserAction } from "./actions";
import { useDialogFormAction } from "@/components/use-dialog-form";
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
import { PasswordInput } from "@/components/ui/password-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const ROLE_LABELS: Record<UserRole, string> = {
  Admin: "Admin",
  Editor: "Editor",
  Viewer: "Betrachter",
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  Admin: "Vollzugriff inklusive Benutzerverwaltung und Einstellungen",
  Editor: "Darf Buchungen, Konten, Kategorien und Budgets bearbeiten",
  Viewer: "Darf alles ansehen, aber nichts ändern",
};

export function UserFormDialog({
  user,
  trigger,
}: {
  user?: UserListItem;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useDialogFormAction(saveUserAction, {
    onSuccess: () => setOpen(false),
    successMessage: user ? "Benutzer gespeichert." : "Benutzer angelegt.",
  });
  const [role, setRole] = useState<UserRole>(user?.role ?? "Editor");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{user ? "Benutzer bearbeiten" : "Neuer Benutzer"}</DialogTitle>
          <DialogDescription>
            Alle Benutzer sehen dieselben Konten und Buchungen — die Rolle steuert, wer etwas
            ändern darf.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4">
          {user && <input type="hidden" name="id" value={user.id} />}
          <input type="hidden" name="role" value={role} />

          <div className="flex flex-col gap-2">
            <Label htmlFor="user-name">Name</Label>
            <Input id="user-name" name="name" defaultValue={user?.name} required autoFocus />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="user-email">E-Mail</Label>
            <Input
              id="user-email"
              name="email"
              type="email"
              defaultValue={user?.email}
              required
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="user-role">Rolle</Label>
            <Select value={role} onValueChange={(value) => setRole(value as UserRole)}>
              <SelectTrigger id="user-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(UserRole).map((value) => (
                  <SelectItem key={value} value={value}>
                    {ROLE_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="user-password">
              {user ? "Neues Passwort (leer = unverändert)" : "Passwort"}
            </Label>
            <PasswordInput
              id="user-password"
              name="password"
              autoComplete="new-password"
              minLength={user ? undefined : 8}
              required={!user}
            />
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
