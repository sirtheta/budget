"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { postRecurringNowAction } from "@/app/(app)/recurring/actions";
import { Button } from "@/components/ui/button";

/** Confirms one due `autoPost: false` entry straight from the dashboard. */
export function PostSuggestionButton({ id }: { id: number }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await postRecurringNowAction(id);
          if (result.error) toast.error(result.error);
          else toast.success("Buchung erfasst.");
        })
      }
    >
      <Check className="h-3.5 w-3.5" /> Buchen
    </Button>
  );
}
