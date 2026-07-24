import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { monthName } from "@/lib/date";
import { Button } from "@/components/ui/button";

/** Previous/next month around a given one, handling the year rollover. */
export function shiftMonth(year: number, month: number, delta: number) {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

export function MonthNav({
  year,
  month,
  basePath,
}: {
  year: number;
  month: number;
  /** Route the arrows link to, e.g. `/budget`. */
  basePath: string;
}) {
  const previous = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);
  const href = (target: { year: number; month: number }) =>
    `${basePath}?year=${target.year}&month=${target.month}`;

  return (
    <div className="flex items-center gap-1">
      <Button variant="outline" size="icon" asChild aria-label="Vorheriger Monat">
        <Link href={href(previous)}>
          <ChevronLeft className="h-4 w-4" />
        </Link>
      </Button>
      <span className="min-w-40 text-center text-sm font-medium tabular-nums">
        {monthName(month)} {year}
      </span>
      <Button variant="outline" size="icon" asChild aria-label="Nächster Monat">
        <Link href={href(next)}>
          <ChevronRight className="h-4 w-4" />
        </Link>
      </Button>
    </div>
  );
}
