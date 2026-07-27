"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import type { Transaction } from "@prisma/client";
import { convertToTransferAction, saveTransactionAction, saveTransferAction } from "./actions";
import type { CategoryOption } from "@/lib/categories";
import { formatDateCH } from "@/lib/date";
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
import { cn } from "@/lib/utils";

export interface AccountOption {
  id: number;
  name: string;
}

const NO_CATEGORY = "none";

type Mode = "booking" | "transfer";

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
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>(isTransfer ? "transfer" : "booking");

  return (
    <Dialog open={open} onOpenChange={setOpen} modal={false}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{transaction ? "Buchung bearbeiten" : "Neue Buchung"}</DialogTitle>
          <DialogDescription>
            {mode === "booking"
              ? "Einnahme oder Ausgabe auf einem Konto."
              : transaction && !isTransfer
                ? "Ordnet dieser Buchung ein Gegenkonto zu, statt sie zu löschen und neu zu erfassen."
                : "Verschiebung zwischen zwei eigenen Konten — zählt nicht als Ausgabe."}
          </DialogDescription>
        </DialogHeader>

        {!isTransfer && (
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            {(
              [
                ["booking", "Einnahme / Ausgabe"],
                ["transfer", "Umbuchung"],
              ] as const
            ).map(([value, label]) => (
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
            defaultChecked
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
            defaultChecked
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
