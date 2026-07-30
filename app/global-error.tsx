"use client";

import { useEffect } from "react";
import "./globals.css";

/**
 * Last-resort boundary: catches errors thrown by the root layout itself, which
 * the segment-level `error.tsx` files sit inside of and therefore cannot catch.
 * It replaces the whole document, so it has to bring its own `<html>`/`<body>`
 * and must not reach for the theme provider or any app chrome — those are
 * exactly what may have failed. Styling stays close to the light palette for
 * the same reason: the theme class is applied by a script this page never runs.
 */
export default function GlobalError({
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
    <html lang="de">
      <body className="flex min-h-screen items-center justify-center bg-white p-4 text-neutral-900 antialiased">
        <div className="w-full max-w-md space-y-4 rounded-xl border border-neutral-200 p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold">Die Anwendung konnte nicht geladen werden</h1>
          <p className="text-sm text-neutral-600">
            Es ist ein unerwarteter Fehler aufgetreten. Deine Daten sind unverändert.
          </p>
          {error.digest && (
            <p className="text-xs text-neutral-500">
              Fehler-Kennung: <code className="font-mono">{error.digest}</code>
            </p>
          )}
          <button
            onClick={reset}
            className="inline-flex h-9 items-center justify-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white transition-colors hover:bg-neutral-800"
          >
            Erneut versuchen
          </button>
        </div>
      </body>
    </html>
  );
}
