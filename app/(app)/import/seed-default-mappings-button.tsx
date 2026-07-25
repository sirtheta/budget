"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { seedDefaultCsvMappingsAction } from "./mapping-actions";
import { Button } from "@/components/ui/button";

/**
 * One-click starter mappings for CSV-only exports (Migros Kreditkarte,
 * Revolut) — the same bootstrap idea as SeedDefaultsButton on the categories
 * page and SeedDefaultRulesButton here, so those two common formats don't
 * need to be mapped column-by-column by hand.
 */
export function SeedDefaultMappingsButton() {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await seedDefaultCsvMappingsAction();
          if (result.error) toast.error(result.error);
          else if (!result.created) toast.info("Alle Standardmappings sind bereits vorhanden.");
          else toast.success(`${result.created} Standardmappings angelegt.`);
        })
      }
    >
      <Sparkles className="h-3.5 w-3.5" /> {pending ? "Anlegen…" : "Standardmappings anlegen"}
    </Button>
  );
}
