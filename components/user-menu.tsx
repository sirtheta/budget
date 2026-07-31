"use client";

import { useState } from "react";
import { HelpCircle, KeyRound, LogOut, ShieldCheck, User as UserIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChangePasswordDialog } from "@/components/change-password-dialog";
import { TwoFactorDialog } from "@/components/two-factor-dialog";
import { signOutAction } from "@/app/(app)/actions";

export function UserMenu({
  name,
  email,
  twoFactorEnabled,
}: {
  name: string;
  email: string;
  twoFactorEnabled: boolean;
}) {
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [twoFactorDialogOpen, setTwoFactorDialogOpen] = useState(false);

  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex items-center justify-center size-8 rounded-full bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors"
            aria-label="Benutzermenü"
          >
            {initials || <UserIcon className="size-4" />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>
            <div className="flex flex-col">
              <span className="font-medium">{name}</span>
              <span className="text-xs text-muted-foreground">{email}</span>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setPasswordDialogOpen(true)}>
            <KeyRound className="mr-2 inline h-4 w-4" /> Passwort ändern
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setTwoFactorDialogOpen(true)}>
            <ShieldCheck className="mr-2 inline h-4 w-4" />
            Zwei-Faktor-Authentifizierung{twoFactorEnabled ? " (aktiv)" : ""}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <a href="/benutzerhandbuch.html" target="_blank" rel="noopener noreferrer">
              <HelpCircle className="mr-2 inline h-4 w-4" /> Benutzerhandbuch
            </a>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => signOutAction()}>
            <LogOut className="mr-2 inline h-4 w-4" /> Abmelden
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangePasswordDialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen} />
      <TwoFactorDialog
        open={twoFactorDialogOpen}
        onOpenChange={setTwoFactorDialogOpen}
        enabled={twoFactorEnabled}
      />
    </>
  );
}
