"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Error boundary for the login / password-reset flow. Separate from the one in
 * `(app)` because it must not offer a link into the protected area: whoever
 * sees this screen is by definition not signed in yet.
 */
export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <div className="rounded-full bg-destructive/10 p-3">
            <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
          </div>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">Anmeldung nicht möglich</h1>
            <p className="text-sm text-muted-foreground">
              Beim Laden der Seite ist ein Fehler aufgetreten. Bitte versuche es erneut.
            </p>
          </div>
          {error.digest && (
            <p className="text-xs text-muted-foreground">
              Fehler-Kennung: <code className="font-mono">{error.digest}</code>
            </p>
          )}
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={reset}>
              <RotateCw className="h-4 w-4" /> Erneut versuchen
            </Button>
            <Button variant="outline" asChild>
              <Link href="/login">Zur Anmeldung</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
