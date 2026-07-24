"use client";

import Link from "next/link";
import { useActionState } from "react";
import { resetPasswordAction } from "./actions";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(resetPasswordAction, undefined);

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Neues Passwort setzen</CardTitle>
        <CardDescription>Wähle ein neues Passwort (mindestens 8 Zeichen).</CardDescription>
      </CardHeader>
      <CardContent>
        {state?.success ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm">Dein Passwort wurde geändert. Du kannst dich jetzt anmelden.</p>
            <Button asChild>
              <Link href="/login">Zur Anmeldung</Link>
            </Button>
          </div>
        ) : (
          <form action={formAction} className="flex flex-col gap-4">
            <input type="hidden" name="token" value={token} />
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Neues Passwort</Label>
              <PasswordInput
                id="password"
                name="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="passwordConfirm">Passwort bestätigen</Label>
              <PasswordInput
                id="passwordConfirm"
                name="passwordConfirm"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
            <Button type="submit" disabled={pending} className="mt-2">
              {pending ? "Wird gespeichert…" : "Passwort ändern"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
