import { cn } from "@/lib/utils";

/**
 * Placeholder block for `loading.tsx` files. Marked `aria-hidden` because a
 * screen reader gains nothing from a pile of empty boxes — the surrounding
 * `loading.tsx` carries the status message instead.
 */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}
