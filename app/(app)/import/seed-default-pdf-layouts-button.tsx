"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { seedDefaultPdfLayoutsAction } from "./pdf-layout-actions";
import { Button } from "@/components/ui/button";

/** One-click starter PDF layout (Migros Kreditkarte), like SeedDefaultMappingsButton for CSV. */
export function SeedDefaultPdfLayoutsButton() {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await seedDefaultPdfLayoutsAction();
          if (result.error) toast.error(result.error);
          else if (!result.created) toast.info("Alle Standardlayouts sind bereits vorhanden.");
          else toast.success(`${result.created} Standardlayout angelegt.`);
        })
      }
    >
      <Sparkles className="h-3.5 w-3.5" /> {pending ? "Anlegen…" : "Standardlayouts anlegen"}
    </Button>
  );
}
