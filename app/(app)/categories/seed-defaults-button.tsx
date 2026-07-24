"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { seedDefaultCategoriesAction } from "./actions";
import { Button } from "@/components/ui/button";

/**
 * One-click bootstrap of a usable category tree. Without it the first thing a
 * new user faces is inventing twenty categories before booking anything.
 */
export function SeedDefaultsButton() {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await seedDefaultCategoriesAction();
          if (result.error) toast.error(result.error);
          else if (result.created === 0) toast.info("Alle Standardkategorien sind bereits vorhanden.")
          else toast.success(`${result.created} Standardkategorien angelegt.`);
        })
      }
    >
      <Sparkles className="h-4 w-4" />
      {pending ? "Anlegen…" : "Standardkategorien anlegen"}
    </Button>
  );
}
