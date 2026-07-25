"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { seedDefaultImportRulesAction } from "./rule-actions";
import { Button } from "@/components/ui/button";

/**
 * One-click starter rule set for a Swiss household — the same bootstrap idea
 * as SeedDefaultsButton on the categories page, so a fresh import doesn't
 * land entirely in "ohne Kategorie" before any rule exists.
 */
export function SeedDefaultRulesButton() {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await seedDefaultImportRulesAction();
          if (result.error) toast.error(result.error);
          else if (!result.created) toast.info("Keine passenden Standardregeln gefunden.");
          else toast.success(`${result.created} Standardregeln angelegt.`);
        })
      }
    >
      <Sparkles className="h-3.5 w-3.5" /> {pending ? "Anlegen…" : "Standardregeln anlegen"}
    </Button>
  );
}
