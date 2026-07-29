"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import type { Transaction } from "@prisma/client";
import {
  convertToTransferAction,
  getSplitPartsAction,
  saveSplitAction,
  saveTransactionAction,
  saveTransferAction,
  unsplitTransactionAction,
} from "./actions";
import type { CategoryOption } from "@/lib/categories";
import { formatDateCH } from "@/lib/date";
import { parseMoney, splitEvenly } from "@/lib/money";
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
import { Textarea } from "@/components/ui/textarea";
import { Combobox } from "@/components/ui/combobox";
import { Money } from "@/components/money";
import { useConfirm } from "@/components/confirm-dialog";
import { cn } from "@/lib/utils";

export interface AccountOption {
  id: number;
  name: string;
}

const NO_CATEGORY = "none";

type Mode = "booking" | "transfer" | "split";

export function TransactionFormDialog({
  transaction,
  accounts,
  categories,
  today,
  trigger,
}: {
  transaction?: Transaction;
  accounts: AccountOption[];
  categories: CategoryOption[];
  /** Today in the app timezone; the server must not rely on the browser clock. */
  today: string;
  trigger: React.ReactNode;
}) {
  const isTransfer = !!transaction?.transferGroupId;
  const isSplit = !!transaction?.splitGroupId;
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>(isTransfer ? "transfer" : isSplit ? "split" : "booking");

  const tabs: Array<[Mode, string]> = [
    ["booking", "Einnahme / Ausgabe"],
    ["transfer", "Umbuchung"],
  ];
  if (transaction) tabs.push(["split", "Aufteilen"]);

  return (
    <Dialog open={open} onOpenChange={setOpen} modal={false}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{transaction ? "Buchung bearbeiten" : "Neue Buchung"}</DialogTitle>
          <DialogDescription>
            {mode === "booking"
              ? "Einnahme oder Ausgabe auf einem Konto."
              : mode === "split"
                ? "Teilt eine Buchung auf mehrere Kategorien auf, z. B. einen 13. Monatslohn."
                : transaction && !isTransfer
                  ? "Ordnet dieser Buchung ein Gegenkonto zu, statt sie zu löschen und neu zu erfassen."
                  : "Verschiebung zwischen zwei eigenen Konten — zählt nicht als Ausgabe."}
          </DialogDescription>
        </DialogHeader>

        {!isTransfer && !isSplit && (
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            {tabs.map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  mode === value
                    ? "bg-background shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {mode === "booking" ? (
          <BookingForm
            transaction={transaction}
            accounts={accounts}
            categories={categories}
            today={today}
            onDone={() => setOpen(false)}
          />
        ) : mode === "split" && transaction ? (
          <SplitForm
            transaction={transaction}
            categories={categories}
            onDone={() => setOpen(false)}
          />
        ) : transaction && !isTransfer ? (
          <ConvertToTransferForm
            transaction={transaction}
            accounts={accounts}
            onCancel={() => setMode("booking")}
            onDone={() => setOpen(false)}
          />
        ) : (
          <TransferForm
            transaction={transaction}
            accounts={accounts}
            today={today}
            onDone={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function BookingForm({
  transaction,
  accounts,
  categories,
  today,
  onDone,
}: {
  transaction?: Transaction;
  accounts: AccountOption[];
  categories: CategoryOption[];
  today: string;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveTransactionAction, undefined);
  const [direction, setDirection] = useState<"expense" | "income">(
    transaction && transaction.amountCents > 0 ? "income" : "expense"
  );
  const [accountId, setAccountId] = useState(
    String(transaction?.accountId ?? accounts[0]?.id ?? "")
  );
  const [categoryId, setCategoryId] = useState(
    String(transaction?.categoryId ?? NO_CATEGORY)
  );

  useEffect(() => {
    if (state?.success) {
      toast.success(
        state.autoApplied
          ? `Buchung gespeichert. Regel erstellt, ${state.autoApplied} weitere Buchung(en) automatisch kategorisiert.`
          : transaction
            ? "Buchung gespeichert."
            : "Buchung erfasst."
      );
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Only categories matching the chosen direction — an expense can't land in
  // an income category, so offering them would only invite the error the
  // Server Action then rejects.
  const visibleCategories = categories.filter((category) =>
    direction === "income" ? category.kind === "Income" : category.kind === "Expense"
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {transaction && <input type="hidden" name="id" value={transaction.id} />}
      <input type="hidden" name="direction" value={direction} />
      <input type="hidden" name="accountId" value={accountId} />
      <input
        type="hidden"
        name="categoryId"
        value={categoryId === NO_CATEGORY ? "" : categoryId}
      />
      <input type="hidden" name="counterparty" value={transaction?.counterparty ?? ""} />

      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {(
          [
            ["expense", "Ausgabe"],
            ["income", "Einnahme"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setDirection(value);
              setCategoryId(NO_CATEGORY);
            }}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              direction === value
                ? value === "income"
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 shadow-sm"
                  : "bg-destructive/15 text-destructive shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="amount">Betrag (CHF)</Label>
          <Input
            id="amount"
            name="amount"
            inputMode="decimal"
            placeholder="82.40"
            defaultValue={
              transaction ? (Math.abs(transaction.amountCents) / 100).toFixed(2) : ""
            }
            required
            autoFocus
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="date">Datum</Label>
          <Input
            id="date"
            name="date"
            type="date"
            defaultValue={transaction?.date ?? today}
            required
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="description">Beschreibung</Label>
        <Input
          id="description"
          name="description"
          defaultValue={transaction?.description}
          placeholder="z. B. Wocheneinkauf"
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="account-trigger">Konto</Label>
          <Combobox
            id="account-trigger"
            value={accountId}
            onValueChange={setAccountId}
            options={accounts.map((account) => ({
              value: String(account.id),
              label: account.name,
            }))}
            placeholder="Konto wählen"
            searchPlaceholder="Konto suchen…"
            emptyText="Kein Konto gefunden."
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="category-trigger">Kategorie</Label>
          <Combobox
            id="category-trigger"
            value={categoryId}
            onValueChange={setCategoryId}
            options={[
              { value: NO_CATEGORY, label: "Ohne Kategorie" },
              ...visibleCategories.map((category) => ({
                value: String(category.id),
                label: category.label,
              })),
            ]}
            placeholder="Kategorie wählen"
            searchPlaceholder="Kategorie suchen…"
            emptyText="Keine Kategorie gefunden."
          />
        </div>
      </div>

      {transaction?.counterparty && categoryId !== NO_CATEGORY && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="createRule"
            className="mt-1 size-4 accent-primary"
          />
          <span>
            Regel erstellen
            <span className="block text-xs text-muted-foreground">
              Künftige und bestehende Buchungen von „{transaction.counterparty}“ automatisch als „
              {categories.find((c) => String(c.id) === categoryId)?.label ?? ""}“ kategorisieren.
            </span>
          </span>
        </label>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="notes">Notiz (optional)</Label>
        <Textarea id="notes" name="notes" defaultValue={transaction?.notes ?? ""} rows={2} />
      </div>

      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Abbrechen
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Speichern…" : "Speichern"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function TransferForm({
  transaction,
  accounts,
  today,
  onDone,
}: {
  transaction?: Transaction;
  accounts: AccountOption[];
  today: string;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveTransferAction, undefined);
  // On an existing transfer the row the user clicked may be either leg; the
  // negative one is always the source.
  const isOutgoing = (transaction?.amountCents ?? -1) < 0;
  const [fromAccountId, setFromAccountId] = useState(
    String(isOutgoing ? (transaction?.accountId ?? accounts[0]?.id ?? "") : (accounts[0]?.id ?? ""))
  );
  const [toAccountId, setToAccountId] = useState(
    String(!isOutgoing ? (transaction?.accountId ?? accounts[1]?.id ?? "") : (accounts[1]?.id ?? ""))
  );

  useEffect(() => {
    if (state?.success) {
      toast.success(transaction ? "Umbuchung gespeichert." : "Umbuchung erfasst.");
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {transaction?.transferGroupId && (
        <input type="hidden" name="transferGroupId" value={transaction.transferGroupId} />
      )}
      <input type="hidden" name="fromAccountId" value={fromAccountId} />
      <input type="hidden" name="toAccountId" value={toAccountId} />

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="transfer-amount">Betrag (CHF)</Label>
          <Input
            id="transfer-amount"
            name="amount"
            inputMode="decimal"
            placeholder="500.00"
            defaultValue={
              transaction ? (Math.abs(transaction.amountCents) / 100).toFixed(2) : ""
            }
            required
            autoFocus
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="transfer-date">Datum</Label>
          <Input
            id="transfer-date"
            name="date"
            type="date"
            defaultValue={transaction?.date ?? today}
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="from-trigger">Von Konto</Label>
          <Combobox
            id="from-trigger"
            value={fromAccountId}
            onValueChange={setFromAccountId}
            options={accounts.map((account) => ({
              value: String(account.id),
              label: account.name,
            }))}
            placeholder="Quellkonto"
            searchPlaceholder="Konto suchen…"
            emptyText="Kein Konto gefunden."
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="to-trigger">Auf Konto</Label>
          <Combobox
            id="to-trigger"
            value={toAccountId}
            onValueChange={setToAccountId}
            options={accounts.map((account) => ({
              value: String(account.id),
              label: account.name,
            }))}
            placeholder="Zielkonto"
            searchPlaceholder="Konto suchen…"
            emptyText="Kein Konto gefunden."
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="transfer-description">Beschreibung</Label>
        <Input
          id="transfer-description"
          name="description"
          defaultValue={transaction?.description ?? "Umbuchung"}
          required
        />
      </div>

      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Abbrechen
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Speichern…" : "Speichern"}
        </Button>
      </DialogFooter>
    </form>
  );
}

interface SplitRow {
  categoryId: string;
  /** Raw text as typed; parsed with parseMoney on every render. */
  amount: string;
}

/**
 * Splits one booking across several categories — e.g. a 13th salary that
 * arrives as a single CAMT.053 booking but needs to be spread over two
 * budget categories. Re-opening an already-split booking loads its existing
 * parts (fetched by splitGroupId, since the row the user clicked is only one
 * of several) so they can be adjusted rather than started over.
 */
function SplitForm({
  transaction,
  categories,
  onDone,
}: {
  transaction: Transaction;
  categories: CategoryOption[];
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveSplitAction, undefined);
  const isEditingSplit = !!transaction.splitGroupId;
  const direction = transaction.amountCents < 0 ? "expense" : "income";
  const visibleCategories = categories.filter((category) =>
    direction === "income" ? category.kind === "Income" : category.kind === "Expense"
  );

  const [loading, setLoading] = useState(isEditingSplit);
  const [totalCents, setTotalCents] = useState(Math.abs(transaction.amountCents));
  const [rows, setRows] = useState<SplitRow[]>(
    isEditingSplit
      ? []
      : [
          {
            categoryId: transaction.categoryId ? String(transaction.categoryId) : NO_CATEGORY,
            amount: (Math.abs(transaction.amountCents) / 100).toFixed(2),
          },
          { categoryId: NO_CATEGORY, amount: "" },
        ]
  );

  useEffect(() => {
    if (!isEditingSplit || !transaction.splitGroupId) return;
    let cancelled = false;
    getSplitPartsAction(transaction.splitGroupId).then((parts) => {
      if (cancelled) return;
      setTotalCents(parts.reduce((sum, part) => sum + Math.abs(part.amountCents), 0));
      setRows(
        parts.map((part) => ({
          categoryId: part.categoryId ? String(part.categoryId) : NO_CATEGORY,
          amount: (Math.abs(part.amountCents) / 100).toFixed(2),
        }))
      );
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state?.success) {
      toast.success("Buchung aufgeteilt.");
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const updateRow = (index: number, patch: Partial<SplitRow>) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };
  const addRow = () => setRows((prev) => [...prev, { categoryId: NO_CATEGORY, amount: "" }]);
  const removeRow = (index: number) =>
    setRows((prev) => (prev.length > 2 ? prev.filter((_, i) => i !== index) : prev));
  const distributeEvenly = () => {
    const shares = splitEvenly(totalCents, rows.length);
    setRows((prev) => prev.map((row, i) => ({ ...row, amount: (shares[i] / 100).toFixed(2) })));
  };

  const parsedAmounts = rows.map((row) => parseMoney(row.amount));
  const sumCents = parsedAmounts.reduce((sum: number, cents) => sum + Math.abs(cents ?? 0), 0);
  const remainingCents = totalCents - sumCents;
  const allRowsValid =
    parsedAmounts.every((cents) => cents !== null && cents > 0) &&
    rows.every((row) => row.categoryId !== NO_CATEGORY);
  const canSubmit = !loading && allRowsValid && remainingCents === 0;

  const partsJson = JSON.stringify(
    rows.map((row, i) => ({
      categoryId: row.categoryId === NO_CATEGORY ? null : parseInt(row.categoryId, 10),
      amountCents: Math.abs(parsedAmounts[i] ?? 0),
    }))
  );

  if (loading) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Lade Aufteilung…</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={transaction.id} />
      <input type="hidden" name="parts" value={partsJson} />

      <p className="text-sm text-muted-foreground">
        {formatDateCH(transaction.date)} · {transaction.description} ·{" "}
        <Money cents={direction === "income" ? totalCents : -totalCents} colored />
      </p>

      <div className="flex flex-col gap-3">
        {rows.map((row, index) => (
          <div key={index} className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-2">
              {index === 0 && <Label htmlFor={`split-category-${index}`}>Kategorie</Label>}
              <Combobox
                id={`split-category-${index}`}
                value={row.categoryId}
                onValueChange={(value) => updateRow(index, { categoryId: value })}
                options={[
                  { value: NO_CATEGORY, label: "Kategorie wählen" },
                  ...visibleCategories.map((category) => ({
                    value: String(category.id),
                    label: category.label,
                  })),
                ]}
                placeholder="Kategorie wählen"
                searchPlaceholder="Kategorie suchen…"
                emptyText="Keine Kategorie gefunden."
              />
            </div>
            <div className="flex w-28 flex-col gap-2">
              {index === 0 && <Label htmlFor={`split-amount-${index}`}>Betrag (CHF)</Label>}
              <Input
                id={`split-amount-${index}`}
                inputMode="decimal"
                placeholder="0.00"
                value={row.amount}
                onChange={(e) => updateRow(index, { amount: e.target.value })}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9 shrink-0 text-destructive disabled:text-muted-foreground"
              aria-label="Kategorie entfernen"
              disabled={rows.length <= 2}
              onClick={() => removeRow(index)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          <Plus className="h-4 w-4" /> Kategorie hinzufügen
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={distributeEvenly}>
          Gleichmässig aufteilen
        </Button>
      </div>

      <p className={cn("text-sm", remainingCents === 0 ? "text-muted-foreground" : "text-destructive")}>
        {remainingCents === 0
          ? "Beträge ergeben zusammen die gebuchte Summe."
          : `Noch zu verteilen: ${(remainingCents / 100).toFixed(2)} CHF`}
      </p>

      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

      <DialogFooter className="sm:justify-between">
        {isEditingSplit && transaction.splitGroupId ? (
          <UnsplitButton splitGroupId={transaction.splitGroupId} onDone={onDone} />
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onDone}>
            Abbrechen
          </Button>
          <Button type="submit" disabled={pending || !canSubmit}>
            {pending ? "Speichern…" : "Aufteilen"}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}

/** Collapses a split booking back into a single, uncategorised booking. */
function UnsplitButton({ splitGroupId, onDone }: { splitGroupId: string; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();

  const handleClick = async () => {
    if (
      !(await confirm({
        description: "Aufteilung aufheben und zu einer einzelnen, unkategorisierten Buchung zusammenführen?",
        confirmLabel: "Zusammenführen",
        variant: "default",
      }))
    ) {
      return;
    }
    startTransition(async () => {
      const result = await unsplitTransactionAction(splitGroupId);
      if (result.error) toast.error(result.error);
      else {
        toast.success("Aufteilung aufgehoben.");
        onDone();
      }
    });
  };

  return (
    <Button
      type="button"
      variant="ghost"
      className="text-muted-foreground"
      onClick={handleClick}
      disabled={pending}
    >
      Aufteilung aufheben
    </Button>
  );
}

/**
 * Converts an already-booked, non-transfer transaction into one leg of a
 * transfer — the manual counterpart to a transfer import rule, for the
 * one-off case that isn't worth a rule. Date, amount and description stay as
 * they are; only the other side of the movement needs to be picked.
 */
function ConvertToTransferForm({
  transaction,
  accounts,
  onCancel,
  onDone,
}: {
  transaction: Transaction;
  accounts: AccountOption[];
  onCancel: () => void;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(convertToTransferAction, undefined);
  const [targetAccountId, setTargetAccountId] = useState("");

  useEffect(() => {
    if (state?.success) {
      toast.success(
        state.autoApplied
          ? `Als Umbuchung markiert. Regel erstellt, ${state.autoApplied} weitere Buchung(en) automatisch umgebucht.`
          : "Als Umbuchung markiert."
      );
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const otherAccounts = accounts.filter((account) => account.id !== transaction.accountId);
  const targetName = accounts.find((account) => String(account.id) === targetAccountId)?.name ?? "";

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={transaction.id} />
      <input type="hidden" name="targetAccountId" value={targetAccountId} />

      <p className="text-sm text-muted-foreground">
        {formatDateCH(transaction.date)} · {transaction.description} ·{" "}
        <Money cents={transaction.amountCents} colored />
      </p>

      <div className="flex flex-col gap-2">
        <Label htmlFor="convert-target">Gegenkonto</Label>
        <Combobox
          id="convert-target"
          value={targetAccountId}
          onValueChange={setTargetAccountId}
          options={otherAccounts.map((account) => ({
            value: String(account.id),
            label: account.name,
          }))}
          placeholder="Konto wählen"
          searchPlaceholder="Konto suchen…"
          emptyText="Kein Konto gefunden."
        />
        <p className="text-xs text-muted-foreground">
          Passt eine bestehende Buchung auf diesem Konto zu Datum und Betrag, wird sie verknüpft —
          sonst wird die Gegenbuchung automatisch angelegt.
        </p>
      </div>

      {transaction.counterparty && targetAccountId && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="createRule"
            className="mt-1 size-4 accent-primary"
          />
          <span>
            Regel erstellen
            <span className="block text-xs text-muted-foreground">
              Künftige und bestehende Buchungen von „{transaction.counterparty}“ automatisch als
              Umbuchung zu „{targetName}“ buchen.
            </span>
          </span>
        </label>
      )}

      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Zurück
        </Button>
        <Button type="submit" disabled={pending || !targetAccountId}>
          {pending ? "Umwandeln…" : "Als Umbuchung markieren"}
        </Button>
      </DialogFooter>
    </form>
  );
}
