"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AppFooter } from "@/components/app-footer";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, undefined);

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <div className="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Haushaltsbudget</CardTitle>
            <CardDescription>Melde dich mit deinem Konto an.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={formAction} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">E-Mail</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  readOnly={state?.needsTwoFactor}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="password">Passwort</Label>
                <PasswordInput
                  id="password"
                  name="password"
                  autoComplete="current-password"
                  required
                  readOnly={state?.needsTwoFactor}
                />
              </div>
              {state?.needsTwoFactor && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="code">Code</Label>
                  <Input
                    id="code"
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="6-stelliger Code oder Wiederherstellungscode"
                    autoFocus
                    required
                  />
                </div>
              )}
              {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
              <Button type="submit" disabled={pending} className="mt-2">
                {pending ? "Anmelden…" : "Anmelden"}
              </Button>
              <Link
                href="/forgot-password"
                className="text-center text-sm text-muted-foreground hover:underline"
              >
                Passwort vergessen?
              </Link>
            </form>
          </CardContent>
        </Card>
      </div>
      <AppFooter />
    </div>
  );
}
