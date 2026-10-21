"use client";

import { useState } from "react";
import { History } from "lucide-react";
import { loadHoldingHistoryAction } from "./actions";
import type { HoldingEntryKind, HoldingHistoryRow } from "@/lib/btc-history";
import { formatMoney } from "@/lib/money";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const KIND_LABELS: Record<HoldingEntryKind, string> = {
  Initial: "Anfangsbestand",
  Stake: "Anteil erfasst",
  Purchase: "Kauf",
  PurchaseReversal: "Kauf gelöscht",
  Edit: "Konto bearbeitet",
};

const dateFormat = new Intl.DateTimeFormat("de-CH", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Zurich",
});

function signedBtc(value: number) {
  const text = value.toFixed(8);
  return value > 0 ? `+${text}` : text;
}

/**
 * Every recorded change of the BTC holding of the given accounts, newest first,
 * with the resulting balance — so a mistyped entry can be spotted and then
 * reverted with an opposite one. Loaded when opened, not with the page.
 */
export function BtcHistoryDialog({
  accountIds,
  title,
}: {
  accountIds: number[];
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<HoldingHistoryRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  async function load() {
    setFailed(false);
    try {
      setRows(await loadHoldingHistoryAction(accountIds));
    } catch {
      setFailed(true);
    }
  }

  const showAccount = accountIds.length > 1;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
      modal={false}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <History className="h-4 w-4" /> Verlauf
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Verlauf — {title}</DialogTitle>
          <DialogDescription>
            Erfasste Bestandsänderungen, neueste zuerst. Einen Fehler korrigierst du mit einer
            Gegenbuchung (negativer Wert) oder über «Konto bearbeiten».
          </DialogDescription>
        </DialogHeader>

        {failed ? (
          <p className="text-sm text-destructive">Verlauf konnte nicht geladen werden.</p>
        ) : rows === null ? (
          <p className="text-sm text-muted-foreground">Lade…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Noch keine Einträge. Änderungen werden ab jetzt festgehalten.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Zeitpunkt</TableHead>
                {showAccount && <TableHead>Anteil</TableHead>}
                <TableHead>Art</TableHead>
                <TableHead className="text-right">Änderung BTC</TableHead>
                <TableHead className="text-right">Änderung CHF</TableHead>
                <TableHead className="text-right">Bestand danach</TableHead>
                <TableHead>Von</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap">
                    {dateFormat.format(new Date(row.createdAt))}
                  </TableCell>
                  {showAccount && <TableCell>{row.accountName}</TableCell>}
                  <TableCell>{KIND_LABELS[row.kind] ?? row.kind}</TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {signedBtc(row.btcDelta)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.costDeltaCents === 0
                      ? "—"
                      : formatMoney(row.costDeltaCents, { forceSign: true })}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {row.btcAfter.toFixed(8)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.userName ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}
