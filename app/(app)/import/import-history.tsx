"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import {
  deleteCsvMappingAction,
} from "./mapping-actions";
import { deleteImportBatchAction, loadMoreImportBatchesAction, type ImportBatchRow } from "./actions";
import { deleteImportRuleAction, toggleImportRuleAction } from "./rule-actions";
import { formatDateCH } from "@/lib/date";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useConfirm } from "@/components/confirm-dialog";

export function DeleteBatchButton({
  id,
  filename,
  count,
  onDeleted,
}: {
  id: number;
  filename: string;
  count: number;
  onDeleted?: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8 text-destructive"
      aria-label="Import rückgängig machen"
      disabled={pending}
      onClick={async () => {
        if (
          !(await confirm({
            description: `Import "${filename}" rückgängig machen? Die ${count} daraus entstandenen Buchungen werden gelöscht.`,
            confirmLabel: "Rückgängig machen",
          }))
        )
          return;
        startTransition(async () => {
          const result = await deleteImportBatchAction(id);
          if (result.error) toast.error(result.error);
          else {
            toast.success(`${result.deleted} Buchung(en) entfernt.`);
            onDeleted?.();
          }
        });
      }}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
}

export function DeleteMappingButton({ id, name }: { id: number; name: string }) {
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8 text-destructive"
      aria-label="Mapping löschen"
      disabled={pending}
      onClick={async () => {
        if (!(await confirm({ description: `Mapping "${name}" wirklich löschen?` }))) return;
        startTransition(async () => {
          const result = await deleteCsvMappingAction(id);
          if (result.error) toast.error(result.error);
          else toast.success("Mapping gelöscht.");
        });
      }}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
}

export function RuleToggle({ id, isActive }: { id: number; isActive: boolean }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await toggleImportRuleAction(id, !isActive);
          if (result.error) toast.error(result.error);
        })
      }
    >
      {isActive ? "Aktiv" : "Inaktiv"}
    </Button>
  );
}

export function DeleteRuleButton({ id, name }: { id: number; name: string }) {
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8 text-destructive"
      aria-label="Regel löschen"
      disabled={pending}
      onClick={async () => {
        if (!(await confirm({ description: `Regel "${name}" wirklich löschen?` }))) return;
        startTransition(async () => {
          const result = await deleteImportRuleAction(id);
          if (result.error) toast.error(result.error);
          else toast.success("Regel gelöscht.");
        });
      }}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
}

export function ImportHistoryList({
  initialBatches,
  initialHasMore,
}: {
  initialBatches: ImportBatchRow[];
  initialHasMore: boolean;
}) {
  const [batches, setBatches] = useState(initialBatches);
  // Tracks how many rows have been fetched from the server, independent of
  // `batches.length` — deleting a row shrinks the displayed list but must not
  // shift the next page's offset, or the row after the gap gets re-fetched.
  const [fetchedCount, setFetchedCount] = useState(initialBatches.length);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, startLoading] = useTransition();

  const removeBatch = (id: number) => setBatches((prev) => prev.filter((batch) => batch.id !== id));

  const loadMore = () =>
    startLoading(async () => {
      const result = await loadMoreImportBatchesAction(fetchedCount);
      setBatches((prev) => [...prev, ...result.batches]);
      setFetchedCount((prev) => prev + result.batches.length);
      setHasMore(result.hasMore);
    });

  if (batches.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Noch nichts importiert.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Datei</TableHead>
                <TableHead>Konto</TableHead>
                <TableHead>Zeitraum</TableHead>
                <TableHead className="text-right">Importiert</TableHead>
                <TableHead className="text-right">Übersprungen</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((batch) => (
                <TableRow key={batch.id}>
                  <TableCell>
                    <span className="font-medium">{batch.filename}</span>
                    <Badge variant="outline" className="ml-2">
                      {batch.format === "Camt053" ? "CAMT.053" : "CSV"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {batch.accountName ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm tabular-nums">
                    {batch.periodFrom && batch.periodTo
                      ? `${formatDateCH(batch.periodFrom)} – ${formatDateCH(batch.periodTo)}`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{batch.importedCount}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {batch.skippedCount}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <DeleteBatchButton
                        id={batch.id}
                        filename={batch.filename}
                        count={batch.importedCount}
                        onDeleted={() => removeBatch(batch.id)}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <ul className="md:hidden divide-y">
          {batches.map((batch) => (
            <li key={batch.id} className="flex items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="font-medium truncate">
                  {batch.filename}
                  <Badge variant="outline" className="ml-2">
                    {batch.format === "Camt053" ? "CAMT.053" : "CSV"}
                  </Badge>
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {batch.accountName ?? "—"}
                  {batch.periodFrom && batch.periodTo &&
                    ` · ${formatDateCH(batch.periodFrom)} – ${formatDateCH(batch.periodTo)}`}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {batch.importedCount} importiert · {batch.skippedCount} übersprungen
                </p>
              </div>
              <DeleteBatchButton
                id={batch.id}
                filename={batch.filename}
                count={batch.importedCount}
                onDeleted={() => removeBatch(batch.id)}
              />
            </li>
          ))}
        </ul>

        {hasMore && (
          <div className="flex justify-center border-t p-3">
            <Button variant="ghost" size="sm" disabled={loading} onClick={loadMore}>
              {loading ? "Lädt…" : "Mehr laden"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
