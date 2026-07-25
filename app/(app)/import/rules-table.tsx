"use client";

import { useMemo, useState } from "react";
import { Pencil, Plus, Search } from "lucide-react";
import type { ImportRule } from "@prisma/client";
import { MATCH_TYPE_LABELS, RULE_FIELD_LABELS } from "@/lib/import/rule-labels";
import { formatMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApplyRulesButton, RuleDialog } from "./rule-dialog";
import { SeedDefaultRulesButton } from "./seed-default-rules-button";
import { DeleteRuleButton, RuleToggle } from "./import-history";
import type { CategoryOption } from "@/lib/categories";
import type { AccountOption } from "@/app/(app)/transactions/transaction-form-dialog";

type RuleRow = ImportRule & {
  category: { name: string; parent: { name: string } | null } | null;
  transferAccount: { name: string } | null;
};

function matchesSearch(rule: RuleRow, query: string): boolean {
  const haystack = [
    rule.name,
    rule.pattern,
    RULE_FIELD_LABELS[rule.field],
    MATCH_TYPE_LABELS[rule.matchType],
    rule.category?.name,
    rule.category?.parent?.name,
    rule.transferAccount?.name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(query.toLowerCase());
}

export function RulesTable({
  rules,
  categories,
  accounts,
}: {
  rules: RuleRow[];
  categories: CategoryOption[];
  accounts: AccountOption[];
}) {
  const [query, setQuery] = useState("");

  const filteredRules = useMemo(
    () => (query.trim() === "" ? rules : rules.filter((rule) => matchesSearch(rule, query))),
    [rules, query]
  );

  return (
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
            accounts={accounts}
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
          <>
            <div className="relative px-4 pt-4 pb-2">
              <Search className="pointer-events-none absolute left-7 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Regeln durchsuchen…"
                className="pl-8"
              />
            </div>
            {filteredRules.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                Keine Regel passt zu „{query}“.
              </p>
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
                    {filteredRules.map((rule) => (
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
                          {(rule.minAmountCents !== null || rule.maxAmountCents !== null) && (
                            <span className="block text-xs mt-0.5">
                              {rule.minAmountCents !== null && rule.maxAmountCents !== null
                                ? `${formatMoney(rule.minAmountCents, { withCurrency: true })} – ${formatMoney(rule.maxAmountCents, { withCurrency: true })}`
                                : rule.minAmountCents !== null
                                  ? `ab ${formatMoney(rule.minAmountCents, { withCurrency: true })}`
                                  : `bis ${formatMoney(rule.maxAmountCents!, { withCurrency: true })}`}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {rule.transferAccount ? (
                            <Badge variant="secondary">
                              → Umbuchung: {rule.transferAccount.name}
                            </Badge>
                          ) : (
                            <>
                              {rule.category?.parent && (
                                <span className="text-muted-foreground">
                                  {rule.category.parent.name} ›{" "}
                                </span>
                              )}
                              {rule.category?.name}
                            </>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end">
                            <RuleToggle id={rule.id} isActive={rule.isActive} />
                            <RuleDialog
                              rule={rule}
                              categories={categories}
                              accounts={accounts}
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
          </>
        )}
      </CardContent>
    </Card>
  );
}
