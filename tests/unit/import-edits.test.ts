import { describe, expect, it } from "vitest";
import type { CategoryOption } from "@/lib/categories";
import type { ImportPreview, PreviewRow } from "@/app/(app)/import/actions";
import {
  defaultSelectionOf,
  editsReducer,
  rowsSharingCounterparty,
  selectionOf,
  type EditAction,
  type EditIntent,
  type EditState,
} from "@/app/(app)/import/import-edits";

function row(overrides: Partial<PreviewRow> & { hash: string }): PreviewRow {
  return {
    date: "2026-01-15",
    amountCents: -1000,
    description: "Buchung",
    counterparty: null,
    bankReference: null,
    categoryId: null,
    categorySource: null,
    transferAccountId: null,
    transferAccountName: null,
    isAdopted: false,
    isDuplicate: false,
    ...overrides,
  };
}

function preview(rows: PreviewRow[]): ImportPreview {
  return {
    accountId: 1,
    accountName: "Privatkonto",
    filename: "auszug.xml",
    format: "Camt053",
    rows,
    warnings: [],
    rejectedRows: [],
    duplicateCount: rows.filter((r) => r.isDuplicate).length,
    uncategorizedCount: rows.filter((r) => r.categoryId === null).length,
    closingBalanceCents: null,
    periodFrom: null,
    periodTo: null,
    balanceDeltaCents: null,
  } as ImportPreview;
}

/** Applies an intent the way the wizard does, filling in the shared context. */
function send(
  state: EditState | null,
  current: ImportPreview,
  defaultSelected: Set<string>,
  intent: EditIntent
): EditState {
  return editsReducer(state, { ...intent, preview: current, defaultSelected } as EditAction);
}

const CATEGORY: CategoryOption = { id: 7, label: "Lebensmittel", kind: "Expense" } as CategoryOption;

describe("defaultSelectionOf", () => {
  it("encodes a rule-suggested category", () => {
    expect(defaultSelectionOf(row({ hash: "a", categoryId: 3 }))).toBe("cat:3");
  });

  it("encodes a rule-suggested transfer", () => {
    expect(defaultSelectionOf(row({ hash: "a", transferAccountId: 2 }))).toBe("transfer:2");
  });

  it("falls back to no category", () => {
    expect(defaultSelectionOf(row({ hash: "a" }))).toBe("cat:none");
  });

  it("prefers a transfer over a category when a rule set both", () => {
    expect(defaultSelectionOf(row({ hash: "a", categoryId: 3, transferAccountId: 2 }))).toBe(
      "transfer:2"
    );
  });
});

describe("selectionOf", () => {
  const target = row({ hash: "a", categoryId: 3 });

  it("uses the rule suggestion when there is no override", () => {
    expect(selectionOf(null, target)).toBe("cat:3");
  });

  it("prefers the user's override", () => {
    const state = { overrides: { a: "cat:9" } } as unknown as EditState;
    expect(selectionOf(state, target)).toBe("cat:9");
  });

  it("honours an override back to no category", () => {
    // "none" is a real choice, not an absent one — the row was suggested a
    // category and the user rejected it.
    const state = { overrides: { a: "cat:none" } } as unknown as EditState;
    expect(selectionOf(state, target)).toBe("cat:none");
  });
});

describe("editsReducer", () => {
  const rows = [row({ hash: "a" }), row({ hash: "b" }), row({ hash: "c", isDuplicate: true })];
  const current = preview(rows);
  const defaults = new Set(["a", "b"]);

  it("starts from the defaults when there is no state yet", () => {
    const next = send(null, current, defaults, { type: "toggleRow", hash: "a", checked: false });

    expect([...next.selected]).toEqual(["b"]);
    expect(next.overrides).toEqual({});
    expect(next.done).toBeNull();
  });

  it("discards edits belonging to a previous preview", () => {
    // Row hashes from the old file mean nothing against the new one; carrying
    // them over would silently select or categorise unrelated rows.
    const stale = send(null, current, defaults, { type: "overrideRow", hash: "a", value: "cat:5" });
    const reread = preview([row({ hash: "x" })]);

    const next = send(stale, reread, new Set(["x"]), {
      type: "toggleRow",
      hash: "x",
      checked: true,
    });

    expect(next.preview).toBe(reread);
    expect(next.overrides).toEqual({});
    expect([...next.selected]).toEqual(["x"]);
  });

  it("keeps edits across actions on the same preview", () => {
    let state = send(null, current, defaults, { type: "overrideRow", hash: "a", value: "cat:5" });
    state = send(state, current, defaults, { type: "toggleRow", hash: "b", checked: false });

    expect(state.overrides).toEqual({ a: "cat:5" });
    expect([...state.selected]).toEqual(["a"]);
  });

  it("does not mutate the previous state", () => {
    const first = send(null, current, defaults, { type: "toggleRow", hash: "a", checked: false });
    const before = [...first.selected];

    send(first, current, defaults, { type: "toggleRow", hash: "b", checked: false });

    expect([...first.selected]).toEqual(before);
  });

  it("selects every non-duplicate row shown", () => {
    const next = send(null, current, new Set(), { type: "selectAllNew", rows });

    expect([...next.selected].sort()).toEqual(["a", "b"]);
  });

  it("leaves selections outside the date filter alone when selecting all", () => {
    // "Alle neuen" only decides what happens to what is on screen.
    const state = send(null, current, new Set(["hidden"]), {
      type: "selectAllNew",
      rows: [rows[0]],
    });

    expect([...state.selected].sort()).toEqual(["a", "hidden"]);
  });

  it("leaves selections outside the date filter alone when clearing", () => {
    const state = send(null, current, new Set(["a", "b", "hidden"]), {
      type: "selectNone",
      rows: [rows[0], rows[1]],
    });

    expect([...state.selected]).toEqual(["hidden"]);
  });

  it("records the import result", () => {
    const next = send(null, current, defaults, { type: "markDone", imported: 4, skipped: 1 });

    expect(next.done).toEqual({ imported: 4, skipped: 1 });
  });

  it("keeps the selection when recording the result", () => {
    const state = send(null, current, defaults, { type: "toggleRow", hash: "a", checked: false });
    const next = send(state, current, defaults, { type: "markDone", imported: 1, skipped: 0 });

    expect([...next.selected]).toEqual(["b"]);
  });
});

describe("rowsSharingCounterparty", () => {
  it("includes other uncategorised rows with the same counterparty", () => {
    const rows = [
      row({ hash: "a", counterparty: "Coop Bern" }),
      row({ hash: "b", counterparty: "  coop bern  " }),
      row({ hash: "c", counterparty: "Migros" }),
    ];

    const matches = rowsSharingCounterparty(preview(rows), rows[0], {});

    expect(matches.map((r) => r.hash)).toEqual(["a", "b"]);
  });

  it("never touches a row the user already decided about", () => {
    const rows = [
      row({ hash: "a", counterparty: "Coop" }),
      row({ hash: "b", counterparty: "Coop" }),
      row({ hash: "c", counterparty: "Coop", categoryId: 4 }),
      row({ hash: "d", counterparty: "Coop", transferAccountId: 2 }),
      row({ hash: "e", counterparty: "Coop", isAdopted: true }),
    ];

    const matches = rowsSharingCounterparty(preview(rows), rows[0], { b: "cat:9" });

    expect(matches.map((r) => r.hash)).toEqual(["a"]);
  });

  it("matches only the clicked row when it has no counterparty", () => {
    // Without a counterparty there is no signal to group on, and grouping every
    // counterparty-less row together would be plainly wrong.
    const rows = [row({ hash: "a", counterparty: null }), row({ hash: "b", counterparty: null })];

    const matches = rowsSharingCounterparty(preview(rows), rows[0], {});

    expect(matches.map((r) => r.hash)).toEqual(["a"]);
  });

  it("is what applyCategoryToSimilar writes overrides from", () => {
    const rows = [
      row({ hash: "a", counterparty: "Coop" }),
      row({ hash: "b", counterparty: "Coop" }),
      row({ hash: "c", counterparty: "Migros" }),
    ];
    const current = preview(rows);

    const next = send(null, current, new Set(), {
      type: "applyCategoryToSimilar",
      row: rows[0],
      category: CATEGORY,
    });

    expect(next.overrides).toEqual({ a: "cat:7", b: "cat:7" });
  });
});
