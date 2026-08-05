"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { GripVertical } from "lucide-react";
import type { Account } from "@prisma/client";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { reorderAccountsAction } from "./actions";
import { ACCOUNT_TYPE_LABELS } from "@/lib/balances";
import type { AccountOption } from "./btc-purchase-dialog";
import type { CategoryOption } from "@/lib/categories";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AccountRowActions } from "./account-row-actions";
import { BtcPurchaseDialog } from "./btc-purchase-dialog";

export type BtcInfo = {
  amount: number | null;
  rate: number | null;
  costBasisCents: number | null;
  gainLossCents: number | null;
};

export function AccountsList({
  accounts,
  balanceById,
  btcById,
  sourceAccounts,
  categories,
  currentRateChf,
  today,
}: {
  accounts: Account[];
  balanceById: Record<number, number>;
  btcById: Record<number, BtcInfo>;
  sourceAccounts: AccountOption[];
  categories: CategoryOption[];
  currentRateChf: number | null;
  today: string;
}) {
  const [order, setOrder] = useState(() => accounts.map((a) => a.id));

  // `accounts` comes from a server re-render (create/delete/toggle) while
  // `order` is local drag state. Resync during render rather than in an
  // effect (React's documented pattern for adjusting state from props) so a
  // create/delete doesn't briefly render with a stale order — keep the
  // dragged order for ids that survived and append new ones.
  const [prevAccounts, setPrevAccounts] = useState(accounts);
  if (accounts !== prevAccounts) {
    setPrevAccounts(accounts);
    const incomingIds = accounts.map((a) => a.id);
    const incomingSet = new Set(incomingIds);
    const currentSet = new Set(order);
    const unchanged =
      incomingSet.size === currentSet.size && incomingIds.every((id) => currentSet.has(id));
    if (!unchanged) {
      const kept = order.filter((id) => incomingSet.has(id));
      const added = incomingIds.filter((id) => !currentSet.has(id));
      setOrder([...kept, ...added]);
    }
  }

  const byId = new Map(accounts.map((a) => [a.id, a]));
  const ordered = order.map((id) => byId.get(id)).filter((a): a is Account => a !== undefined);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = order.indexOf(active.id as number);
    const newIndex = order.indexOf(over.id as number);
    const next = arrayMove(order, oldIndex, newIndex);
    setOrder(next);
    reorderAccountsAction(next).then((result) => {
      if (result.error) toast.error(result.error);
    });
  };

  return (
    <>
      {/* Two independent DnD contexts, not one shared across both: the
          desktop table and mobile list are both always in the DOM (Tailwind
          just hides one via CSS), so a single SortableContext would register
          each account id on two nodes at once and dnd-kit would track drag
          deltas against the wrong one — rows never visibly moved. */}
      {/* Explicit ids: without one, dnd-kit derives the drag handles'
          aria-describedby from a module-level counter that keeps incrementing
          across requests on the server while the client starts from zero, so
          the markup never matches on hydration. */}
      <DndContext
        id="accounts-table"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Konto</TableHead>
                  <TableHead>Art</TableHead>
                  <TableHead>IBAN</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {ordered.map((account) => (
                  <SortableRow
                    key={account.id}
                    account={account}
                    balanceCents={balanceById[account.id] ?? 0}
                    btc={btcById[account.id]}
                    sourceAccounts={sourceAccounts}
                    categories={categories}
                    currentRateChf={currentRateChf}
                    today={today}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </SortableContext>
      </DndContext>

      <DndContext
        id="accounts-list"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <ul className="md:hidden divide-y">
            {ordered.map((account) => (
              <SortableListItem
                key={account.id}
                account={account}
                balanceCents={balanceById[account.id] ?? 0}
                btc={btcById[account.id]}
                sourceAccounts={sourceAccounts}
                categories={categories}
                currentRateChf={currentRateChf}
                today={today}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </>
  );
}

function SortableRow({
  account,
  balanceCents,
  btc,
  sourceAccounts,
  categories,
  currentRateChf,
  today,
}: {
  account: Account;
  balanceCents: number;
  btc: BtcInfo | undefined;
  sourceAccounts: AccountOption[];
  categories: CategoryOption[];
  currentRateChf: number | null;
  today: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: account.id,
  });

  return (
    <TableRow
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`${account.isActive ? "" : "opacity-55"} ${isDragging ? "relative z-10 bg-muted" : ""}`}
    >
      <TableCell>
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
          aria-label="Reihenfolge ändern"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <span
            className="size-2.5 rounded-full shrink-0"
            style={{ backgroundColor: account.color ?? "#6366f1" }}
            aria-hidden
          />
          <Link
            href={`/transactions?accountId=${account.id}`}
            // Rendered once per account in both the table and the mobile list:
            // prefetching every one of them renders the booking list that often.
            prefetch={false}
            className="font-medium hover:underline"
          >
            {account.name}
          </Link>
          {!account.isActive && <Badge variant="outline">Inaktiv</Badge>}
          {account.excludeFromBudget && <Badge variant="secondary">Ausserhalb Budget</Badge>}
        </div>
        {account.notes && <p className="text-xs text-muted-foreground mt-0.5">{account.notes}</p>}
      </TableCell>
      <TableCell className="text-muted-foreground">{ACCOUNT_TYPE_LABELS[account.type]}</TableCell>
      <TableCell className="text-muted-foreground font-mono text-xs">
        {account.type === "Crypto"
          ? !btc || btc.amount === null
            ? "—"
            : `${btc.amount} BTC${btc.rate === null ? " (Kurs n/a)" : ` @ ${btc.rate.toLocaleString("de-CH")}`}`
          : (account.iban ?? "—")}
      </TableCell>
      <TableCell className="text-right font-medium">
        <Money cents={balanceCents} colored />
        {account.type === "Crypto" &&
          btc &&
          btc.gainLossCents !== null &&
          btc.costBasisCents &&
          (() => {
            const pct = (btc.gainLossCents! / btc.costBasisCents!) * 100;
            return (
              <p className="text-xs font-normal">
                <Money cents={btc.gainLossCents!} colored forceSign /> (
                {pct >= 0 ? "+" : ""}
                {pct.toFixed(1)}%)
              </p>
            );
          })()}
      </TableCell>
      <TableCell>
        <div className="flex justify-end">
          {account.type === "Crypto" && sourceAccounts.length > 0 && (
            <BtcPurchaseDialog
              cryptoAccountId={account.id}
              sourceAccounts={sourceAccounts}
              categories={categories}
              currentRateChf={currentRateChf}
              today={today}
            />
          )}
          <AccountRowActions account={account} />
        </div>
      </TableCell>
    </TableRow>
  );
}

function SortableListItem({
  account,
  balanceCents,
  btc,
  sourceAccounts,
  categories,
  currentRateChf,
  today,
}: {
  account: Account;
  balanceCents: number;
  btc: BtcInfo | undefined;
  sourceAccounts: AccountOption[];
  categories: CategoryOption[];
  currentRateChf: number | null;
  today: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: account.id,
  });
  const gainLossPct =
    account.type === "Crypto" && btc?.gainLossCents != null && btc.costBasisCents
      ? (btc.gainLossCents / btc.costBasisCents) * 100
      : null;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`p-4 ${account.isActive ? "" : "opacity-55"} ${isDragging ? "relative z-10 bg-muted" : ""}`}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="mt-1 cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
          aria-label="Reihenfolge ändern"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="flex items-start justify-between gap-3 flex-1 min-w-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="size-2.5 rounded-full shrink-0"
                style={{ backgroundColor: account.color ?? "#6366f1" }}
                aria-hidden
              />
              <Link
            href={`/transactions?accountId=${account.id}`}
            // Rendered once per account in both the table and the mobile list:
            // prefetching every one of them renders the booking list that often.
            prefetch={false}
            className="font-medium hover:underline"
          >
                {account.name}
              </Link>
              {!account.isActive && <Badge variant="outline">Inaktiv</Badge>}
              {account.excludeFromBudget && <Badge variant="secondary">Ausserhalb Budget</Badge>}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {ACCOUNT_TYPE_LABELS[account.type]}
              {account.type === "Crypto"
                ? btc && btc.amount !== null
                  ? ` · ${btc.amount} BTC${btc.rate === null ? " (Kurs n/a)" : ` @ ${btc.rate.toLocaleString("de-CH")}`}`
                  : ""
                : account.iban
                  ? ` · ${account.iban}`
                  : ""}
            </p>
            {account.notes && <p className="text-xs text-muted-foreground mt-0.5">{account.notes}</p>}
          </div>
          <div className="text-right shrink-0">
            <p className="font-medium">
              <Money cents={balanceCents} colored />
            </p>
            {gainLossPct !== null && btc && (
              <p className="text-xs">
                <Money cents={btc.gainLossCents!} colored forceSign /> (
                {gainLossPct >= 0 ? "+" : ""}
                {gainLossPct.toFixed(1)}%)
              </p>
            )}
          </div>
        </div>
      </div>
      <div className="flex justify-end mt-2">
        {account.type === "Crypto" && sourceAccounts.length > 0 && (
          <BtcPurchaseDialog
            cryptoAccountId={account.id}
            sourceAccounts={sourceAccounts}
            categories={categories}
            currentRateChf={currentRateChf}
            today={today}
          />
        )}
        <AccountRowActions account={account} />
      </div>
    </li>
  );
}
