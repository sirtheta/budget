"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordResetAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AppFooter } from "@/components/app-footer";

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, undefined);

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <div className="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Passwort vergessen</CardTitle>
            <CardDescription>
              Gib deine E-Mail-Adresse ein — du erhältst einen Link, um ein neues Passwort zu
              setzen.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {state?.success ? (
              <div className="flex flex-col gap-4">
                <p className="text-sm">
                  Falls ein Konto mit dieser Adresse existiert, wurde eine E-Mail mit dem
                  Zurücksetzungslink verschickt. Bitte prüfe auch den Spam-Ordner.
                </p>
                <Button asChild variant="outline">
                  <Link href="/login">Zurück zur Anmeldung</Link>
                </Button>
              </div>
            ) : (
              <form action={formAction} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="email">E-Mail</Label>
                  <Input id="email" name="email" type="email" autoComplete="email" required />
                </div>
                {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
                <Button type="submit" disabled={pending} className="mt-2">
                  {pending ? "Wird gesendet…" : "Link anfordern"}
                </Button>
                <Link
                  href="/login"
                  className="text-center text-sm text-muted-foreground hover:underline"
                >
                  Zurück zur Anmeldung
                </Link>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
      <AppFooter />
    </div>
  );
}
