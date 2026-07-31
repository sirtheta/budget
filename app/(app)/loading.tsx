import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Shared loading shell for every protected route. All pages in `(app)` are
 * `force-dynamic` and query SQLite on each render, so without this the browser
 * sits on the previous page — with nothing indicating that the click was
 * registered — until the query returns.
 */
export default function AppLoading() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Wird geladen …</span>

      <div className="mb-6 space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i}>
            <CardContent className="space-y-2 py-6">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-7 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-4">
        <CardContent className="space-y-3 py-6">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
