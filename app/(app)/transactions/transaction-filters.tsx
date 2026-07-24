"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import type { CategoryOption } from "@/lib/categories";
import type { AccountOption } from "./transaction-form-dialog";
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

const ALL = "all";

export function TransactionFilters({
  accounts,
  categories,
}: {
  accounts: AccountOption[];
  categories: CategoryOption[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(params.get("q") ?? "");

  const apply = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "" || value === ALL) next.delete(key);
      else next.set(key, value);
    }
    // Any filter change invalidates the current page number.
    next.delete("page");
    startTransition(() => router.push(`/transactions?${next.toString()}`));
  };

  const hasFilters = ["q", "from", "to", "accountId", "categoryId", "type"].some((key) =>
    params.has(key)
  );

  return (
    <div className="flex flex-wrap items-end gap-3 mb-4">
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          apply({ q: query });
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="q" className="text-xs">
            Suche
          </Label>
          <Input
            id="q"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Beschreibung oder Gegenpartei"
            className="w-56"
          />
        </div>
        <Button type="submit" variant="secondary" size="icon" aria-label="Suchen">
          <Search className="h-4 w-4" />
        </Button>
      </form>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="from" className="text-xs">
          Von
        </Label>
        <Input
          id="from"
          type="date"
          defaultValue={params.get("from") ?? ""}
          onChange={(event) => apply({ from: event.target.value })}
          className="w-40"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="to" className="text-xs">
          Bis
        </Label>
        <Input
          id="to"
          type="date"
          defaultValue={params.get("to") ?? ""}
          onChange={(event) => apply({ to: event.target.value })}
          className="w-40"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-account" className="text-xs">
          Konto
        </Label>
        <Select
          value={params.get("accountId") ?? ALL}
          onValueChange={(value) => apply({ accountId: value })}
        >
          <SelectTrigger id="filter-account" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Alle Konten</SelectItem>
            {accounts.map((account) => (
              <SelectItem key={account.id} value={String(account.id)}>
                {account.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-category" className="text-xs">
          Kategorie
        </Label>
        <Select
          value={params.get("categoryId") ?? ALL}
          onValueChange={(value) => apply({ categoryId: value })}
        >
          <SelectTrigger id="filter-category" className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Alle Kategorien</SelectItem>
            <SelectItem value="none">Ohne Kategorie</SelectItem>
            {categories.map((category) => (
              <SelectItem key={category.id} value={String(category.id)}>
                {category.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-type" className="text-xs">
          Art
        </Label>
        <Select
          value={params.get("type") ?? ALL}
          onValueChange={(value) => apply({ type: value })}
        >
          <SelectTrigger id="filter-type" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Alle</SelectItem>
            <SelectItem value="income">Einnahmen</SelectItem>
            <SelectItem value="expense">Ausgaben</SelectItem>
            <SelectItem value="transfer">Umbuchungen</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {hasFilters && (
        <Button
          variant="ghost"
          onClick={() => {
            setQuery("");
            startTransition(() => router.push("/transactions"));
          }}
          disabled={pending}
        >
          <X className="h-4 w-4" /> Filter zurücksetzen
        </Button>
      )}
    </div>
  );
}
