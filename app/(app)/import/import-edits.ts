import type { CategoryOption } from "@/lib/categories";
import type { ImportPreview, PreviewRow } from "./actions";

/**
 * The user's edits to the current import preview, and the reducer that owns
 * them.
 *
 * Extracted from the wizard component for two reasons. The base-resolution
 * step below — "does the state I am holding still belong to the preview on
 * screen, and if not, what are the defaults?" — was written out at four call
 * sites, each reaching for the current state slightly differently (two through
 * the state variable, two through a ref) and each having to restate all four
 * fields. Getting one of them wrong loses a user's row selections silently,
 * which is the worst way for an import bug to behave.
 *
 * The other reason is that none of this was reachable from a test. As a pure
 * function it is.
 */

export const NO_CATEGORY = "none";

export interface EditState {
  /**
   * The preview these edits belong to. Edits are tied to the preview object
   * rather than cleared by an effect: when a new file is read the identity no
   * longer matches and the defaults apply again, with no render pass in which
   * stale selections are shown against the new rows.
   */
  preview: ImportPreview;
  /** Row hashes the user wants imported. */
  selected: Set<string>;
  /**
   * Per-row override of the rule-suggested categorisation, keyed by row hash:
   * "none" | `cat:${categoryId}` | `transfer:${accountId}`. Lets a wrongly
   * triggered rule be corrected before the import rather than after.
   */
  overrides: Record<string, string>;
  done: { imported: number; skipped: number } | null;
}

/**
 * Carried by every action. `defaultSelected` cannot live in the reducer: it
 * depends on the date filter, which is component state the reducer never sees.
 */
interface Base {
  preview: ImportPreview;
  defaultSelected: Set<string>;
}

/**
 * What the user did, without the context the wizard fills in. Named separately
 * so callers can be typed against it — `Omit<EditAction, …>` would collapse the
 * variants into one shapeless object and let any combination of fields through.
 */
export type EditIntent =
  | { type: "toggleRow"; hash: string; checked: boolean }
  | { type: "overrideRow"; hash: string; value: string }
  | { type: "applyCategoryToSimilar"; row: PreviewRow; category: CategoryOption }
  | { type: "selectAllNew"; rows: PreviewRow[] }
  | { type: "selectNone"; rows: PreviewRow[] }
  | { type: "markDone"; imported: number; skipped: number };

export type EditAction = EditIntent & Base;

/** The rule-suggested outcome for a row, encoded the same way an override is. */
export function defaultSelectionOf(row: PreviewRow): string {
  return row.transferAccountId
    ? `transfer:${row.transferAccountId}`
    : `cat:${row.categoryId ?? NO_CATEGORY}`;
}

/** What a row will be booked as, override first, rule suggestion otherwise. */
export function selectionOf(state: EditState | null, row: PreviewRow): string {
  return state && row.hash in state.overrides
    ? state.overrides[row.hash]
    : defaultSelectionOf(row);
}

/**
 * Rows a category created inline should also apply to.
 *
 * The whole reason to categorise from a row is that no import rule covers it
 * yet, so applying the new category only to the row that was clicked leaves
 * the user doing it again for every other booking from the same shop. Matching
 * is on counterparty — the same signal the history-based suggestion uses —
 * and never touches a row the user has already decided about, whether by an
 * override, an existing categorisation, or adoption.
 */
export function rowsSharingCounterparty(
  preview: ImportPreview,
  row: PreviewRow,
  overrides: Record<string, string>
): PreviewRow[] {
  const counterparty = row.counterparty?.trim().toLowerCase();
  return preview.rows.filter(
    (candidate) =>
      candidate.hash === row.hash ||
      (!candidate.isAdopted &&
        candidate.categoryId === null &&
        candidate.transferAccountId === null &&
        !!counterparty &&
        candidate.counterparty?.trim().toLowerCase() === counterparty &&
        !(candidate.hash in overrides))
  );
}

/**
 * Resolves the edits currently in force. State from a previous preview is
 * discarded rather than merged — its row hashes mean nothing against the new
 * file.
 */
function resolve(state: EditState | null, { preview, defaultSelected }: Base): EditState {
  const base = state?.preview === preview ? state : null;
  return {
    preview,
    selected: base?.selected ?? defaultSelected,
    overrides: base?.overrides ?? {},
    done: base?.done ?? null,
  };
}

export function editsReducer(state: EditState | null, action: EditAction): EditState {
  const current = resolve(state, action);

  switch (action.type) {
    case "toggleRow": {
      const selected = new Set(current.selected);
      if (action.checked) selected.add(action.hash);
      else selected.delete(action.hash);
      return { ...current, selected };
    }

    case "overrideRow":
      return {
        ...current,
        overrides: { ...current.overrides, [action.hash]: action.value },
      };

    case "applyCategoryToSimilar": {
      const value = `cat:${action.category.id}`;
      const overrides = { ...current.overrides };
      for (const match of rowsSharingCounterparty(action.preview, action.row, current.overrides)) {
        overrides[match.hash] = value;
      }
      return { ...current, overrides };
    }

    case "selectAllNew": {
      // Only decides what happens to what is currently shown — selections
      // outside the date filter are left exactly as they were.
      const shown = new Set(action.rows.map((row) => row.hash));
      const selected = new Set([...current.selected].filter((hash) => !shown.has(hash)));
      for (const row of action.rows) if (!row.isDuplicate) selected.add(row.hash);
      return { ...current, selected };
    }

    case "selectNone": {
      const shown = new Set(action.rows.map((row) => row.hash));
      return {
        ...current,
        selected: new Set([...current.selected].filter((hash) => !shown.has(hash))),
      };
    }

    case "markDone":
      return { ...current, done: { imported: action.imported, skipped: action.skipped } };
  }
}
