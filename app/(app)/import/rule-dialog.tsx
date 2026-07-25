"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Wand2 } from "lucide-react";
import type { ImportRule } from "@prisma/client";
import { RuleField, RuleMatch } from "@prisma/client";
import { applyRulesToUncategorizedAction, saveImportRuleAction } from "./rule-actions";
import { useDialogFormAction } from "@/components/use-dialog-form";
import { MATCH_TYPE_LABELS, RULE_FIELD_LABELS } from "@/lib/import/rule-labels";
import type { CategoryOption } from "@/lib/categories";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";

export function RuleDialog({
  rule,
  categories,
  trigger,
}: {
  rule?: ImportRule;
  categories: CategoryOption[];
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useDialogFormAction(saveImportRuleAction, {
    onSuccess: () => setOpen(false),
    successMessage: rule ? "Regel gespeichert." : "Regel angelegt.",
  });
  const [field, setField] = useState<RuleField>(rule?.field ?? "Description");
  const [matchType, setMatchType] = useState<RuleMatch>(rule?.matchType ?? "Contains");
  const [categoryId, setCategoryId] = useState(String(rule?.categoryId ?? ""));

  return (
    <Dialog open={open} onOpenChange={setOpen} modal={false}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{rule ? "Regel bearbeiten" : "Neue Importregel"}</DialogTitle>
          <DialogDescription>
            Ordnet importierten Buchungen automatisch eine Kategorie zu. Die Regel mit der
            kleinsten Priorität gewinnt — so kann eine spezifische Regel vor einer allgemeinen
            greifen.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4">
          {rule && <input type="hidden" name="id" value={rule.id} />}
          <input type="hidden" name="field" value={field} />
          <input type="hidden" name="matchType" value={matchType} />
          <input type="hidden" name="categoryId" value={categoryId} />

          <div className="flex flex-col gap-2">
            <Label htmlFor="rule-name">Bezeichnung</Label>
            <Input
              id="rule-name"
              name="name"
              defaultValue={rule?.name}
              placeholder="z. B. Migros → Lebensmittel"
              required
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="rule-field">Feld</Label>
              <Select value={field} onValueChange={(value) => setField(value as RuleField)}>
                <SelectTrigger id="rule-field">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(RuleField).map((value) => (
                    <SelectItem key={value} value={value}>
                      {RULE_FIELD_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="rule-match">Vergleich</Label>
              <Select
                value={matchType}
                onValueChange={(value) => setMatchType(value as RuleMatch)}
              >
                <SelectTrigger id="rule-match">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(RuleMatch).map((value) => (
                    <SelectItem key={value} value={value}>
                      {MATCH_TYPE_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="rule-pattern">Suchmuster</Label>
            <Input
              id="rule-pattern"
              name="pattern"
              defaultValue={rule?.pattern}
              placeholder="MIGROS"
              required
            />
            <p className="text-xs text-muted-foreground">
              Gross-/Kleinschreibung spielt keine Rolle.
            </p>
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="rule-category">Kategorie</Label>
              <Combobox
                id="rule-category"
                value={categoryId}
                onValueChange={setCategoryId}
                options={categories.map((category) => ({
                  value: String(category.id),
                  label: category.label,
                }))}
                placeholder="Kategorie wählen"
                searchPlaceholder="Kategorie suchen…"
                emptyText="Keine Kategorie gefunden."
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="rule-priority">Priorität</Label>
              <Input
                id="rule-priority"
                name="priority"
                type="number"
                min={0}
                max={999}
                defaultValue={rule?.priority ?? 0}
                className="w-24"
              />
            </div>
          </div>

          {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={pending || !categoryId}>
              {pending ? "Speichern…" : "Speichern"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Runs the rules over bookings that are still uncategorised. */
export function ApplyRulesButton() {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await applyRulesToUncategorizedAction();
          if (result.error) toast.error(result.error);
          else if (result.updated === 0)
            toast.info("Keine passende Buchung ohne Kategorie gefunden.");
          else toast.success(`${result.updated} Buchung(en) zugeordnet.`);
        })
      }
    >
      <Wand2 className="h-3.5 w-3.5" />
      {pending ? "Anwenden…" : "Auf offene Buchungen anwenden"}
    </Button>
  );
}
