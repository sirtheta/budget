import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * 404 page. Lives at the root rather than inside `(app)`, because an unknown
 * path never matches a route group and so could not use a nested one.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <div className="rounded-full bg-muted p-3">
            <FileQuestion className="h-6 w-6 text-muted-foreground" aria-hidden />
          </div>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">Seite nicht gefunden</h1>
            <p className="text-sm text-muted-foreground">
              Diese Adresse gibt es nicht (mehr).
            </p>
          </div>
          <Button asChild>
            <Link href="/dashboard">Zur Übersicht</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
