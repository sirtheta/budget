"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import {
  startTwoFactorSetupAction,
  confirmTwoFactorSetupAction,
  disableTwoFactorAction,
} from "@/app/(app)/actions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";

export function TwoFactorDialog({
  open,
  onOpenChange,
  enabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  enabled: boolean;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
      }}
    >
      <DialogContent>
        {enabled ? <DisableTwoFactor onDone={() => onOpenChange(false)} /> : <SetupTwoFactor onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function SetupTwoFactor({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [starting, startTransition] = useTransition();
  const [setup, setSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [confirmState, confirmAction, confirmPending] = useActionState(
    confirmTwoFactorSetupAction,
    undefined
  );

  useEffect(() => {
    startTransition(async () => {
      const result = await startTwoFactorSetupAction();
      if (result.error) toast.error(result.error);
      else if (result.secret && result.qrDataUrl) {
        setSetup({ secret: result.secret, qrDataUrl: result.qrDataUrl });
      }
    });
  }, []);

  if (confirmState?.backupCodes) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Wiederherstellungscodes</DialogTitle>
          <DialogDescription>
            Jeder Code funktioniert einmal, falls das Gerät mit der Authenticator-App verloren
            geht. Bewahre sie sicher auf — sie werden nur jetzt angezeigt.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2 rounded-md border bg-muted/30 p-4 font-mono text-sm">
          {confirmState.backupCodes.map((code) => (
            <span key={code}>{code}</span>
          ))}
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              router.refresh();
              onDone();
            }}
          >
            Fertig
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Zwei-Faktor-Authentifizierung einrichten</DialogTitle>
        <DialogDescription>
          Scanne den QR-Code mit einer Authenticator-App (z. B. Google Authenticator, LastPass Authenticator) und
          gib den angezeigten 6-stelligen Code ein.
        </DialogDescription>
      </DialogHeader>
      {starting || !setup ? (
        <p className="text-sm text-muted-foreground">Wird vorbereitet…</p>
      ) : (
        <form action={confirmAction} className="flex flex-col gap-4">
          <div className="flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={setup.qrDataUrl}
              alt="QR-Code für die Authenticator-App"
              className="h-44 w-44 rounded-md border"
            />
          </div>
          <p className="text-center text-xs text-muted-foreground break-all">
            Manuell: <span className="font-mono">{setup.secret}</span>
          </p>
          <div className="flex flex-col gap-2">
            <Label htmlFor="code">Code aus der App</Label>
            <Input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              autoFocus
            />
          </div>
          {confirmState?.error && <p className="text-sm text-destructive">{confirmState.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={confirmPending}>
              {confirmPending ? "Prüfen…" : "Aktivieren"}
            </Button>
          </DialogFooter>
        </form>
      )}
    </>
  );
}

function DisableTwoFactor({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(disableTwoFactorAction, undefined);

  useEffect(() => {
    if (state?.success) {
      toast.success("Zwei-Faktor-Authentifizierung deaktiviert.");
      router.refresh();
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" /> Zwei-Faktor-Authentifizierung
        </DialogTitle>
        <DialogDescription>
          Ist für dein Konto aktiviert. Zum Deaktivieren bestätige dein Passwort.
        </DialogDescription>
      </DialogHeader>
      <form action={formAction} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Aktuelles Passwort</Label>
          <PasswordInput id="password" name="password" autoComplete="current-password" required />
        </div>
        {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
        <DialogFooter>
          <Button type="submit" variant="destructive" disabled={pending}>
            {pending ? "Deaktivieren…" : "Deaktivieren"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
