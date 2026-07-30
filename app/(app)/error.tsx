"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Error boundary for the protected area. Rendered inside `(app)/layout.tsx`,
 * so the navigation stays usable and the user can walk away from the broken
 * page instead of being dropped on a bare error screen.
 *
 * `error.digest` is the only identifier that survives into production — Next.js
 * replaces the real message with a generic one so a stack trace can never leak
 * to the browser. Showing the digest is what makes a report actionable, since
 * the matching server log line carries the same value.
 */
export default function AppError({
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
    <Card className="mx-auto max-w-lg">
      <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
        <div className="rounded-full bg-destructive/10 p-3">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
        </div>
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Da ist etwas schiefgelaufen</h1>
          <p className="text-sm text-muted-foreground">
            Die Seite konnte nicht geladen werden. Deine Daten sind unverändert — es wurde
            nichts gespeichert.
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
            <Link href="/dashboard">Zur Übersicht</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
