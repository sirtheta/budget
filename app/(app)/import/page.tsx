import { Pencil, Plus } from "lucide-react";
import prisma from "@/lib/prisma";
import { requireEditor } from "@/lib/permissions";
import { categoryOptions } from "@/lib/categories";
import { formatDateCH } from "@/lib/date";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ImportWizard } from "./import-wizard";
import { CsvMappingDialog } from "./csv-mapping-dialog";
import { RulesTable } from "./rules-table";
import { SeedDefaultMappingsButton } from "./seed-default-mappings-button";
import { DeleteBatchButton, DeleteMappingButton } from "./import-history";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  await requireEditor();

  const [accounts, categories, parents, mappings, rules, batches] = await Promise.all([
    prisma.account.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    categoryOptions(prisma),
    prisma.category.findMany({
      where: { parentId: null, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, kind: true },
    }),
    prisma.csvMapping.findMany({ orderBy: { name: "asc" } }),
    prisma.importRule.findMany({
      orderBy: [{ priority: "asc" }, { name: "asc" }],
      include: {
        category: { select: { name: true, parent: { select: { name: true } } } },
        transferAccount: { select: { name: true } },
      },
    }),
    prisma.importBatch.findMany({
      orderBy: { createdAt: "desc" },
      take: 15,
      include: { account: { select: { name: true } } },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Import"
        description="Kontoauszüge einlesen, statt jede Buchung von Hand zu erfassen."
      />

      {accounts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Lege zuerst ein Konto an, bevor du einen Auszug importierst.
          </CardContent>
        </Card>
      ) : (
        <ImportWizard accounts={accounts} categories={categories} parents={parents} mappings={mappings} />
      )}

      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mt-10 mb-3">
        Importregeln
      </h2>
      <RulesTable rules={rules} categories={categories} accounts={accounts} />

      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
        CSV-Mappings
      </h2>
      <Card className="mb-8">
        <CardHeader className="flex-row items-start justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-base">Spaltenzuordnung pro Bank</CardTitle>
            <CardDescription>
              Nur nötig für CSV-Import — CAMT.053 braucht keine Zuordnung.
            </CardDescription>
          </div>
          <div className="flex gap-2 flex-wrap w-full sm:w-auto sm:shrink-0">
            {mappings.length === 0 && <SeedDefaultMappingsButton />}
            <CsvMappingDialog
              trigger={
                <Button size="sm">
                  <Plus className="h-3.5 w-3.5" /> Neues Mapping
                </Button>
              }
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {mappings.length === 0 ? (
            <div className="flex flex-col items-center gap-3 p-8 text-center text-sm text-muted-foreground">
              <p>Noch kein Mapping angelegt. Fertige Vorlagen: Migros Kreditkarte, Revolut.</p>
              <SeedDefaultMappingsButton />
            </div>
          ) : (
            <>
            <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Trennzeichen</TableHead>
                    <TableHead>Datumsformat</TableHead>
                    <TableHead>Spalten</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mappings.map((mapping) => (
                    <TableRow key={mapping.id}>
                      <TableCell className="font-medium">{mapping.name}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {mapping.delimiter === "\t" ? "Tab" : mapping.delimiter}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {mapping.dateFormat}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        Datum {mapping.dateColumn} · Text {mapping.descriptionColumn} ·{" "}
                        {mapping.amountColumn !== null
                          ? `Betrag ${mapping.amountColumn}`
                          : `Soll ${mapping.debitColumn ?? "—"} / Haben ${mapping.creditColumn ?? "—"}`}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end">
                          <CsvMappingDialog
                            mapping={mapping}
                            trigger={
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                aria-label="Mapping bearbeiten"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            }
                          />
                          <DeleteMappingButton id={mapping.id} name={mapping.name} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <ul className="md:hidden divide-y">
              {mappings.map((mapping) => (
                <li key={mapping.id} className="flex items-start justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="font-medium">{mapping.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Trennzeichen {mapping.delimiter === "\t" ? "Tab" : mapping.delimiter} ·{" "}
                      {mapping.dateFormat}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Datum {mapping.dateColumn} · Text {mapping.descriptionColumn} ·{" "}
                      {mapping.amountColumn !== null
                        ? `Betrag ${mapping.amountColumn}`
                        : `Soll ${mapping.debitColumn ?? "—"} / Haben ${mapping.creditColumn ?? "—"}`}
                    </p>
                  </div>
                  <div className="flex items-center shrink-0">
                    <CsvMappingDialog
                      mapping={mapping}
                      trigger={
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label="Mapping bearbeiten"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      }
                    />
                    <DeleteMappingButton id={mapping.id} name={mapping.name} />
                  </div>
                </li>
              ))}
            </ul>
            </>
          )}
        </CardContent>
      </Card>

      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
        Importverlauf
      </h2>
      <Card>
        <CardContent className="p-0">
          {batches.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Noch nichts importiert.
            </p>
          ) : (
            <>
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
                        {batch.account?.name ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm tabular-nums">
                        {batch.periodFrom && batch.periodTo
                          ? `${formatDateCH(batch.periodFrom)} – ${formatDateCH(batch.periodTo)}`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {batch.importedCount}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {batch.skippedCount}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          <DeleteBatchButton
                            id={batch.id}
                            filename={batch.filename}
                            count={batch.importedCount}
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
                      {batch.account?.name ?? "—"}
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
                  />
                </li>
              ))}
            </ul>
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
