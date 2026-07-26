"use client";

import { useActionState, useEffect, useTransition } from "react";
import { toast } from "sonner";
import { DatabaseBackup, Mail } from "lucide-react";
import { runBackupNowAction, saveSettingsAction, sendTestMailAction } from "./actions";
import type { EditableSettings } from "./types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function SettingsForm({
  settings,
  hasSmtpPassword,
}: {
  settings: EditableSettings | null;
  /** Whether a password is stored; the value itself never leaves the server. */
  hasSmtpPassword: boolean;
}) {
  const [state, formAction, pending] = useActionState(saveSettingsAction, undefined);

  useEffect(() => {
    if (state?.success) toast.success("Einstellungen gespeichert.");
    if (state?.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Allgemein</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2 sm:w-48">
            <Label htmlFor="currency">Währung</Label>
            <Input
              id="currency"
              name="currency"
              maxLength={3}
              defaultValue={settings?.currency ?? "CHF"}
              required
            />
            <p className="text-xs text-muted-foreground">
              Wird nur für die Anzeige verwendet — die App rechnet nur mit einer einzigen Währung.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">E-Mail (SMTP)</CardTitle>
          <CardDescription>
            Nur für das Zurücksetzen vergessener Passwörter nötig. Das Passwort wird
            verschlüsselt gespeichert.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="smtpHost">Server</Label>
            <Input
              id="smtpHost"
              name="smtpHost"
              defaultValue={settings?.smtpHost ?? ""}
              placeholder="smtp.example.ch"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="smtpPort">Port</Label>
            <Input
              id="smtpPort"
              name="smtpPort"
              type="number"
              defaultValue={settings?.smtpPort ?? 587}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="smtpUser">Benutzer</Label>
            <Input id="smtpUser" name="smtpUser" defaultValue={settings?.smtpUser ?? ""} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="smtpPassword">
              Passwort {hasSmtpPassword && "(leer = unverändert)"}
            </Label>
            <PasswordInput
              id="smtpPassword"
              name="smtpPassword"
              autoComplete="new-password"
              placeholder={hasSmtpPassword ? "••••••••" : ""}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="smtpFromName">Absendername</Label>
            <Input
              id="smtpFromName"
              name="smtpFromName"
              defaultValue={settings?.smtpFromName ?? ""}
              placeholder="Haushaltsbudget"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="smtpFromAddress">Absenderadresse</Label>
            <Input
              id="smtpFromAddress"
              name="smtpFromAddress"
              defaultValue={settings?.smtpFromAddress ?? ""}
              placeholder="budget@example.ch"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Speichern…" : "Einstellungen speichern"}
        </Button>
        <TestMailButton />
        <BackupNowButton />
      </div>
    </form>
  );
}

function TestMailButton() {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await sendTestMailAction();
          if (result.error) toast.error(result.error);
          else toast.success("Test-E-Mail versendet.");
        })
      }
    >
      <Mail className="h-4 w-4" />
      {pending ? "Senden…" : "Test-E-Mail senden"}
    </Button>
  );
}

function BackupNowButton() {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await runBackupNowAction();
          if (result.error) toast.error(result.error);
          else toast.success("Backup geschrieben.");
        })
      }
    >
      <DatabaseBackup className="h-4 w-4" />
      {pending ? "Sichern…" : "Backup jetzt erstellen"}
    </Button>
  );
}
