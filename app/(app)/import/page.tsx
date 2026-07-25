import { Pencil, Plus } from "lucide-react";
import prisma from "@/lib/prisma";
import { requireEditor } from "@/lib/permissions";
import { categoryOptions } from "@/lib/categories";
import { formatDateCH } from "@/lib/date";
import { MATCH_TYPE_LABELS, RULE_FIELD_LABELS } from "@/lib/import/rules";
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
import { ApplyRulesButton, RuleDialog } from "./rule-dialog";
import { SeedDefaultRulesButton } from "./seed-default-rules-button";
import {
  DeleteBatchButton,
  DeleteMappingButton,
  DeleteRuleButton,
  RuleToggle,
} from "./import-history";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  await requireEditor();

  const [accounts, categories, mappings, rules, batches] = await Promise.all([
    prisma.account.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    categoryOptions(prisma),
    prisma.csvMapping.findMany({ orderBy: { name: "asc" } }),
    prisma.importRule.findMany({
      orderBy: [{ priority: "asc" }, { name: "asc" }],
      include: { category: { select: { name: true, parent: { select: { name: true } } } } },
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
        <ImportWizard accounts={accounts} categories={categories} mappings={mappings} />
      )}

      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mt-10 mb-3">
        Importregeln
      </h2>
      <Card className="mb-8">
        <CardHeader className="flex-row items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Automatische Kategorisierung</CardTitle>
            <CardDescription>
              Die erste passende Regel gewinnt. Ohne Regeln landet jeder Import ohne Kategorie.
            </CardDescription>
          </div>
          <div className="flex gap-2 shrink-0">
            {rules.length === 0 && <SeedDefaultRulesButton />}
            {rules.length > 0 && <ApplyRulesButton />}
            <RuleDialog
              categories={categories}
              trigger={
                <Button size="sm">
                  <Plus className="h-3.5 w-3.5" /> Neue Regel
                </Button>
              }
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {rules.length === 0 ? (
            <div className="flex flex-col items-center gap-3 p-8 text-center text-sm text-muted-foreground">
              <p>Noch keine Regeln. Typischer Start: „Beschreibung enthält MIGROS → Lebensmittel“.</p>
              <SeedDefaultRulesButton />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Prio</TableHead>
                    <TableHead>Regel</TableHead>
                    <TableHead>Bedingung</TableHead>
                    <TableHead>Kategorie</TableHead>
                    <TableHead className="w-32" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map((rule) => (
                    <TableRow key={rule.id} className={rule.isActive ? "" : "opacity-55"}>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {rule.priority}
                      </TableCell>
                      <TableCell className="font-medium">{rule.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {RULE_FIELD_LABELS[rule.field]} {MATCH_TYPE_LABELS[rule.matchType]}{" "}
                        <code className="rounded bg-muted px-1 py-0.5 text-xs">
                          {rule.pattern}
                        </code>
                      </TableCell>
                      <TableCell className="text-sm">
                        {rule.category.parent && (
                          <span className="text-muted-foreground">
                            {rule.category.parent.name} ›{" "}
                          </span>
                        )}
                        {rule.category.name}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end">
                          <RuleToggle id={rule.id} isActive={rule.isActive} />
                          <RuleDialog
                            rule={rule}
                            categories={categories}
                            trigger={
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                aria-label="Regel bearbeiten"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            }
                          />
                          <DeleteRuleButton id={rule.id} name={rule.name} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
        CSV-Mappings
      </h2>
      <Card className="mb-8">
        <CardHeader className="flex-row items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Spaltenzuordnung pro Bank</CardTitle>
            <CardDescription>
              Nur nötig für CSV-Import — CAMT.053 braucht keine Zuordnung.
            </CardDescription>
          </div>
          <CsvMappingDialog
            trigger={
              <Button size="sm" className="shrink-0">
                <Plus className="h-3.5 w-3.5" /> Neues Mapping
              </Button>
            }
          />
        </CardHeader>
        <CardContent className="p-0">
          {mappings.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Noch kein Mapping angelegt.
            </p>
          ) : (
            <div className="overflow-x-auto">
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
            <div className="overflow-x-auto">
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
          )}
        </CardContent>
      </Card>
    </>
  );
}
