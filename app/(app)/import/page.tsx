import prisma from "@/lib/prisma";
import { requireEditor } from "@/lib/permissions";
import { categoryOptions } from "@/lib/categories";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { DeleteMappingButton, ImportHistoryList } from "./import-history";
import type { ImportBatchRow } from "./actions";
import { IMPORT_HISTORY_PAGE_SIZE } from "./history-constants";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  await requireEditor();

  const [accounts, categories, parents, mappings, rules, batchPage] = await Promise.all([
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
      take: IMPORT_HISTORY_PAGE_SIZE + 1,
      include: { account: { select: { name: true } } },
    }),
  ]);

  const hasMoreBatches = batchPage.length > IMPORT_HISTORY_PAGE_SIZE;
  const batches: ImportBatchRow[] = batchPage.slice(0, IMPORT_HISTORY_PAGE_SIZE).map((batch) => ({
    id: batch.id,
    filename: batch.filename,
    format: batch.format,
    accountName: batch.account?.name ?? null,
    periodFrom: batch.periodFrom,
    periodTo: batch.periodTo,
    importedCount: batch.importedCount,
    skippedCount: batch.skippedCount,
  }));

  return (
    <>
      <PageHeader
        title="Import"
        description="Kontoauszüge einlesen, statt jede Buchung von Hand zu erfassen."
      />

      <Tabs defaultValue="wizard">
        <TabsList>
          <TabsTrigger value="wizard">Neuer Import</TabsTrigger>
          <TabsTrigger value="rules">Regeln ({rules.length})</TabsTrigger>
          <TabsTrigger value="mappings">CSV-Mappings ({mappings.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="wizard" className="space-y-6">
          {accounts.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                Lege zuerst ein Konto an, bevor du einen Auszug importierst.
              </CardContent>
            </Card>
          ) : (
            <ImportWizard accounts={accounts} categories={categories} parents={parents} mappings={mappings} />
          )}

          <div>
            <h2 className="text-sm font-medium mb-2">Verlauf</h2>
            <ImportHistoryList initialBatches={batches} initialHasMore={hasMoreBatches} />
          </div>
        </TabsContent>

        <TabsContent value="rules">
          <RulesTable rules={rules} categories={categories} accounts={accounts} />
        </TabsContent>

        <TabsContent value="mappings">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-2 flex-wrap">
              <div>
                <CardTitle className="text-base">Spaltenzuordnung pro Bank</CardTitle>
                <CardDescription>
                  Nur nötig für CSV-Import — CAMT.053 braucht keine Zuordnung.
                </CardDescription>
              </div>
              <div className="flex gap-2 flex-wrap w-full sm:w-auto sm:shrink-0">
                {mappings.length === 0 && <SeedDefaultMappingsButton />}
                <CsvMappingDialog />
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
                              <CsvMappingDialog mapping={mapping} />
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
                        <CsvMappingDialog mapping={mapping} />
                        <DeleteMappingButton id={mapping.id} name={mapping.name} />
                      </div>
                    </li>
                  ))}
                </ul>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
