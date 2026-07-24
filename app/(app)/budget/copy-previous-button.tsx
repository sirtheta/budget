"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { CopyPlus } from "lucide-react";
import { copyPreviousMonthAction } from "./actions";
import { Button } from "@/components/ui/button";

export function CopyPreviousButton({ year, month }: { year: number; month: number }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await copyPreviousMonthAction(year, month);
          if (result.error) toast.error(result.error);
          else if (result.copied === 0)
            toast.info("Im Vormonat gibt es keine Budgets, die noch fehlen.");
          else toast.success(`${result.copied} Budget(s) aus dem Vormonat übernommen.`);
        })
      }
    >
      <CopyPlus className="h-4 w-4" />
      {pending ? "Übernehmen…" : "Vormonat übernehmen"}
    </Button>
  );
}
