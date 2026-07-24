"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { changeOwnPasswordAction } from "@/app/(app)/actions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";

export function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [state, formAction, pending] = useActionState(changeOwnPasswordAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.success) {
      toast.success("Passwort geändert.");
      onOpenChange(false);
      formRef.current?.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Passwort ändern</DialogTitle>
        </DialogHeader>
        <form ref={formRef} action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="currentPassword">Aktuelles Passwort</Label>
            <PasswordInput id="currentPassword" name="currentPassword" autoComplete="current-password" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="newPassword">Neues Passwort</Label>
            <PasswordInput id="newPassword" name="newPassword" autoComplete="new-password" minLength={8} required />
          </div>
          {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Speichern…" : "Speichern"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
