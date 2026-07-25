"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { Category } from "@prisma/client";
import { deleteCategoryAction, toggleCategoryActiveAction } from "./actions";
import { CategoryFormDialog } from "./category-form-dialog";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function CategoryRowActions({
  category,
  parents,
}: {
  category: Category;
  parents: Pick<Category, "id" | "name" | "kind" | "color">[];
}) {
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();

  const toggleActive = () => {
    startTransition(async () => {
      const result = await toggleCategoryActiveAction(category.id, !category.isActive);
      if (result.error) toast.error(result.error);
      else toast.success(category.isActive ? "Kategorie deaktiviert." : "Kategorie aktiviert.");
    });
  };

  const remove = async () => {
    if (!(await confirm({ description: `Kategorie "${category.name}" wirklich löschen?` }))) return;
    startTransition(async () => {
      const result = await deleteCategoryAction(category.id);
      if (result.error) toast.error(result.error);
      else toast.success("Kategorie gelöscht.");
    });
  };

  return (
    <div className="flex justify-end opacity-70 group-hover:opacity-100 transition-opacity">
      <CategoryFormDialog
        category={category}
        parents={parents}
        trigger={
          <Button variant="ghost" size="icon" aria-label="Kategorie bearbeiten" className="size-7">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        }
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Weitere Aktionen"
            className="size-7"
            disabled={pending}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={toggleActive}>
            {category.isActive ? (
              <>
                <EyeOff className="mr-2 h-4 w-4" /> Deaktivieren
              </>
            ) : (
              <>
                <Eye className="mr-2 h-4 w-4" /> Aktivieren
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={remove} className="text-destructive">
            <Trash2 className="mr-2 h-4 w-4" /> Löschen
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
