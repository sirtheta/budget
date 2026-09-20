# BTC-Wallet mit Anteilen pro Person — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein physisches Bitcoin-Wallet wird durch mehrere Crypto-Konten (ein Anteil je Person) abgebildet, die zu einer `CryptoWallet` gruppiert sind; Zugänge aller Anteile werden in einer einzigen Maske als Deltas erfasst.

**Architecture:** Neues Modell `CryptoWallet` gruppiert bestehende `Account`-Zeilen vom Typ `Crypto` über `Account.cryptoWalletId`. Bestand und Einstandswert bleiben pro Konto (`btcAmount`, `btcCostBasisCents`) — deshalb ändert sich an Saldo-, Netto-Vermögens- und Analytics-Logik nichts. Eine neue Server Action schreibt alle Anteils-Deltas einer Wallet in einer Transaktion per NULL-sicherem Raw-Increment.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, Prisma + SQLite, Zod, Tailwind 4 / shadcn-ui, Vitest (unit + integration), Playwright (E2E).

**Spec:** `docs/superpowers/specs/2026-09-20-btc-wallet-anteile-design.md`

## Global Constraints

- Beträge sind **signierte Ganzzahlen in Rappen** (`lib/money.ts`), nie Float, nie `Decimal`. BTC-Mengen sind `Float` (bestehendes Schema).
- UI-Texte, Fehlermeldungen und Dokumentation **deutsch**; Code, Kommentare und Commit-Messages **englisch**.
- Commits folgen Conventional Commits (`feat:`, `test:`, `docs:`, Scope `accounts` erwünscht) und enden mit der Zeile `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Server Actions beginnen mit `requireEditor()` aus `lib/permissions.ts`; Mutationen schreiben einen Audit-Eintrag via `logAudit()`.
- Dialog-Formulare nutzen `useDialogFormAction` (`components/use-dialog-form.ts`), nie einen Effect zum Schliessen.
- Vor Änderungen an Routing/Data-Fetching: `node_modules/next/dist/docs/` konsultieren — Next 16 weicht von älteren Konventionen ab.
- Keine CHF-Buchung aus der neuen Maske: sie ändert ausschliesslich `btcAmount` und `btcCostBasisCents`.
- Tests laufen mit `npx vitest run <datei>` bzw. `npm run test:e2e`.

---

### Task 1: Schema, Migration und Audit-Entität

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_crypto_wallet/migration.sql` (von `prisma migrate dev` erzeugt)
- Modify: `lib/audit.ts` (Union `AuditEntity`)
- Modify: `lib/audit-format.ts` (Label-Map)
- Test: `tests/integration/crypto-wallets.test.ts`

**Interfaces:**
- Consumes: nichts.
- Produces: Prisma-Modell `CryptoWallet { id: number; name: string; notes: string | null; sortOrder: number; createdAt: Date; updatedAt: Date }`, Feld `Account.cryptoWalletId: number | null`, Audit-Entität `"CryptoWallet"`.

- [ ] **Step 1: Write the failing test**

`tests/integration/crypto-wallets.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestDb } from "./helpers";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const db = createTestDb();
  prisma = db.prisma;
  cleanup = db.cleanup;
});

afterAll(async () => cleanup());

describe("CryptoWallet schema", () => {
  it("groups crypto accounts and keeps them when the wallet is deleted", async () => {
    const wallet = await prisma.cryptoWallet.create({ data: { name: "Ledger" } });
    const stake = await prisma.account.create({
      data: { name: "Anteil Kind A", type: "Crypto", btcAmount: 0.25, cryptoWalletId: wallet.id },
    });

    const withStakes = await prisma.cryptoWallet.findUniqueOrThrow({
      where: { id: wallet.id },
      include: { accounts: true },
    });
    expect(withStakes.accounts.map((a) => a.id)).toEqual([stake.id]);

    await prisma.cryptoWallet.delete({ where: { id: wallet.id } });

    // onDelete: SetNull — deleting the grouping must never delete balances.
    const survivor = await prisma.account.findUniqueOrThrow({ where: { id: stake.id } });
    expect(survivor.cryptoWalletId).toBeNull();
    expect(survivor.btcAmount).toBe(0.25);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/crypto-wallets.test.ts`
Expected: FAIL — `prisma.cryptoWallet` ist `undefined` (Modell existiert nicht).

- [ ] **Step 3: Add the model and the relation**

In `prisma/schema.prisma`, direkt vor dem Abschnitt `// ── Categories ──`:

```prisma
/// A physical wallet whose contents belong to several people. The wallet holds
/// no balance itself: it only groups Crypto accounts, each standing for one
/// person's stake in it. Balance, net worth and analytics therefore stay
/// account-based and need no special case.
model CryptoWallet {
  id        Int      @id @default(autoincrement())
  name      String
  notes     String?
  sortOrder Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  accounts Account[]

  @@index([sortOrder])
}
```

In `model Account`, unterhalb von `btcCostBasisCents`:

```prisma
  // Crypto accounts only: which physical wallet this account is a stake in.
  // Null means a standalone wallet, which behaves exactly as before.
  cryptoWalletId Int?
```

und bei den Relationen von `Account` (neben `transactions`):

```prisma
  // SetNull, never Cascade: deleting the grouping must not delete the accounts
  // that carry the actual BTC balances.
  cryptoWallet CryptoWallet? @relation(fields: [cryptoWalletId], references: [id], onDelete: SetNull)
```

und bei den Indizes von `Account`:

```prisma
  @@index([cryptoWalletId])
```

- [ ] **Step 4: Create the migration**

Run: `npx prisma migrate dev --name add_crypto_wallet`
Expected: Neuer Ordner unter `prisma/migrations/`, `CREATE TABLE "CryptoWallet"` plus die Änderung an `Account` (SQLite: Prisma schreibt dafür eine Tabellen-Neuanlage mit Datenkopie — das ist normal). Bestehende Konten behalten `cryptoWalletId = NULL`.

- [ ] **Step 5: Extend the audit types**

In `lib/audit.ts`, Union `AuditEntity` ergänzen:

```ts
  | "CsvMapping"
  | "CryptoWallet"
  | "User"
```

In `lib/audit-format.ts`, in der Map `ENTITY_LABELS` neben `Account: "Konto",`:

```ts
  CryptoWallet: "Bitcoin-Wallet",
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/integration/crypto-wallets.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations lib/audit.ts lib/audit-format.ts tests/integration/crypto-wallets.test.ts
git commit -m "feat(accounts): add CryptoWallet grouping for crypto accounts"
```

---

### Task 2: Wallet anlegen, umbenennen, löschen

**Files:**
- Modify: `app/(app)/accounts/actions.ts`
- Test: `tests/integration/crypto-wallets.test.ts` (ergänzen)

**Interfaces:**
- Consumes: Modell `CryptoWallet` aus Task 1, `ActionState` aus `app/(app)/accounts/actions.ts`.
- Produces:
  - `saveCryptoWalletAction(prev: ActionState | undefined, formData: FormData): Promise<ActionState>` — Felder `id?`, `name`, `notes?`.
  - `deleteCryptoWalletAction(id: number): Promise<ActionState>`.

- [ ] **Step 1: Write the failing test**

`tests/integration/crypto-wallets.test.ts` um Mocks ergänzen, nach dem Vorbild von `tests/integration/accounts-action.test.ts` — diese Blöcke gehören **vor** die Imports der Actions:

```ts
const { prismaHolder, sessionHolder, revalidatePathMock } = vi.hoisted(() => ({
  prismaHolder: { current: undefined as unknown },
  sessionHolder: {
    current: { user: { id: "1", role: "Editor", name: "Editor", email: "e@test.ch" } },
  },
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  get default() {
    return prismaHolder.current;
  },
  getDbPath: () => "/unused",
}));
vi.mock("@/lib/permissions", () => ({
  requireEditor: vi.fn(async () => sessionHolder.current),
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { saveCryptoWalletAction, deleteCryptoWalletAction } from "@/app/(app)/accounts/actions";
```

`vi` in die Imports von `vitest` aufnehmen, `beforeAll` um `prismaHolder.current = prisma;` und das Anlegen eines Editor-Users erweitern (wie in `accounts-action.test.ts`), dazu der Helper:

```ts
function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}
```

Neue Blöcke am Dateiende:

```ts
describe("saveCryptoWalletAction", () => {
  it("creates a wallet and logs an audit entry", async () => {
    const result = await saveCryptoWalletAction(undefined, form({ name: "Bitcoin", notes: "" }));
    expect(result.success).toBe(true);

    const wallet = await prisma.cryptoWallet.findFirstOrThrow({ where: { name: "Bitcoin" } });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "CryptoWallet", entityId: wallet.id },
    });
    expect(audit.action).toBe("CREATE");
  });

  it("rejects an empty name", async () => {
    const result = await saveCryptoWalletAction(undefined, form({ name: "  ", notes: "" }));
    expect(result.error).toMatch(/Name/);
  });

  it("renames an existing wallet", async () => {
    const wallet = await prisma.cryptoWallet.create({ data: { name: "Alt" } });
    const result = await saveCryptoWalletAction(
      undefined,
      form({ id: String(wallet.id), name: "Neu", notes: "Hardware" })
    );
    expect(result.success).toBe(true);

    const after = await prisma.cryptoWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(after.name).toBe("Neu");
    expect(after.notes).toBe("Hardware");
  });
});

describe("deleteCryptoWalletAction", () => {
  it("deletes the wallet but keeps its accounts and their balances", async () => {
    const wallet = await prisma.cryptoWallet.create({ data: { name: "Weg" } });
    const stake = await prisma.account.create({
      data: { name: "Anteil X", type: "Crypto", btcAmount: 0.5, cryptoWalletId: wallet.id },
    });

    const result = await deleteCryptoWalletAction(wallet.id);
    expect(result.success).toBe(true);

    const survivor = await prisma.account.findUniqueOrThrow({ where: { id: stake.id } });
    expect(survivor.cryptoWalletId).toBeNull();
    expect(survivor.btcAmount).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/crypto-wallets.test.ts`
Expected: FAIL — `saveCryptoWalletAction is not a function`.

- [ ] **Step 3: Implement both actions**

Am Ende von `app/(app)/accounts/actions.ts`:

```ts
const cryptoWalletSchema = z.object({
  name: z.string().trim().min(1, "Name darf nicht leer sein.").max(80),
  notes: z.string().trim().max(500).optional(),
});

/**
 * Creates or renames a physical wallet. The wallet holds no balance of its
 * own — it only groups the Crypto accounts that stand for each owner's stake.
 */
export async function saveCryptoWalletAction(
  _prevState: ActionState | undefined,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();

  const parsed = cryptoWalletSchema.safeParse({
    name: formData.get("name") ?? "",
    notes: formData.get("notes") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };

  const idRaw = formData.get("id");
  const id = idRaw ? parseInt(String(idRaw), 10) : null;
  const data = { name: parsed.data.name, notes: parsed.data.notes || null };

  if (id) {
    await prisma.cryptoWallet.update({ where: { id }, data });
    await logAudit(session, "UPDATE", "CryptoWallet", id, { name: data.name });
  } else {
    const last = await prisma.cryptoWallet.findFirst({ orderBy: { sortOrder: "desc" } });
    const created = await prisma.cryptoWallet.create({
      data: { ...data, sortOrder: (last?.sortOrder ?? -1) + 1 },
    });
    await logAudit(session, "CREATE", "CryptoWallet", created.id, { name: data.name });
  }

  revalidatePath("/accounts");
  return { success: true };
}

/**
 * Deletes a wallet grouping. The stake accounts survive with
 * `cryptoWalletId = null` (onDelete: SetNull) — losing the grouping must never
 * lose the balances.
 */
export async function deleteCryptoWalletAction(id: number): Promise<ActionState> {
  const session = await requireEditor();

  const wallet = await prisma.cryptoWallet.findUnique({ where: { id } });
  if (!wallet) return { error: "Wallet nicht gefunden." };

  await prisma.cryptoWallet.delete({ where: { id } });
  await logAudit(session, "DELETE", "CryptoWallet", id, { name: wallet.name });

  revalidatePath("/accounts");
  return { success: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/crypto-wallets.test.ts`
Expected: PASS (alle Blöcke).

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/accounts/actions.ts" tests/integration/crypto-wallets.test.ts
git commit -m "feat(accounts): add server actions to manage crypto wallets"
```

---

### Task 3: Anteils-Deltas in einer Transaktion erfassen

**Files:**
- Modify: `app/(app)/accounts/actions.ts`
- Test: `tests/integration/wallet-stakes-action.test.ts`

**Interfaces:**
- Consumes: Modell und Feld aus Task 1, `ActionState`, `parseMoney` aus `lib/money.ts`.
- Produces: `updateWalletStakesAction(prev: ActionState | undefined, formData: FormData): Promise<ActionState>`.
  FormData-Vertrag, den die UI in Task 5 bedient:
  - `walletId` — Zahl.
  - je Anteilskonto `btcDelta-<accountId>` (Dezimalstring, leer = 0, `,` erlaubt) und `costDelta-<accountId>` (CHF-String für `parseMoney`, leer = 0).
  - Negative Werte sind in beiden Feldern erlaubt (Verkauf, Korrektur).

- [ ] **Step 1: Write the failing test**

`tests/integration/wallet-stakes-action.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestDb } from "./helpers";

const { prismaHolder, sessionHolder, revalidatePathMock } = vi.hoisted(() => ({
  prismaHolder: { current: undefined as unknown },
  sessionHolder: {
    current: { user: { id: "1", role: "Editor", name: "Editor", email: "e@test.ch" } },
  },
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  get default() {
    return prismaHolder.current;
  },
  getDbPath: () => "/unused",
}));
vi.mock("@/lib/permissions", () => ({
  requireEditor: vi.fn(async () => sessionHolder.current),
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { updateWalletStakesAction } from "@/app/(app)/accounts/actions";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
let walletId: number;
let mine: number;
let kid: number;
let outsider: number;

beforeAll(async () => {
  const db = createTestDb();
  prisma = db.prisma;
  cleanup = db.cleanup;
  prismaHolder.current = prisma;

  const editor = await prisma.user.create({
    data: { email: "e@test.ch", name: "Editor", passwordHash: "x", role: "Editor" },
  });
  sessionHolder.current = {
    user: { id: String(editor.id), role: "Editor", name: "Editor", email: "e@test.ch" },
  };
});

afterAll(async () => cleanup());

beforeEach(async () => {
  await prisma.auditLog.deleteMany();
  await prisma.account.deleteMany();
  await prisma.cryptoWallet.deleteMany();

  const wallet = await prisma.cryptoWallet.create({ data: { name: "Ledger" } });
  walletId = wallet.id;
  mine = (
    await prisma.account.create({
      data: {
        name: "Anteil Michael",
        type: "Crypto",
        btcAmount: 0.2,
        btcCostBasisCents: 500000,
        cryptoWalletId: wallet.id,
      },
    })
  ).id;
  // btcAmount deliberately NULL: a stake that has never held BTC must not
  // break the COALESCE-based increment.
  kid = (
    await prisma.account.create({
      data: { name: "Anteil Kind A", type: "Crypto", cryptoWalletId: wallet.id },
    })
  ).id;
  outsider = (
    await prisma.account.create({ data: { name: "Fremdes Wallet", type: "Crypto" } })
  ).id;
});

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

describe("updateWalletStakesAction", () => {
  it("adds up several stakes in one submit and logs one audit entry", async () => {
    const result = await updateWalletStakesAction(
      undefined,
      form({
        walletId: String(walletId),
        [`btcDelta-${mine}`]: "0.05",
        [`costDelta-${mine}`]: "1000.00",
        [`btcDelta-${kid}`]: "0,01",
        [`costDelta-${kid}`]: "200",
      })
    );
    expect(result.success).toBe(true);

    const after = await prisma.account.findMany({
      where: { id: { in: [mine, kid] } },
      orderBy: { id: "asc" },
    });
    expect(after[0].btcAmount).toBeCloseTo(0.25, 8);
    expect(after[0].btcCostBasisCents).toBe(600000);
    expect(after[1].btcAmount).toBeCloseTo(0.01, 8);
    expect(after[1].btcCostBasisCents).toBe(20000);

    const audits = await prisma.auditLog.findMany({ where: { entityType: "CryptoWallet" } });
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe("UPDATE");
  });

  it("accepts a negative delta as a sale", async () => {
    const result = await updateWalletStakesAction(
      undefined,
      form({
        walletId: String(walletId),
        [`btcDelta-${mine}`]: "-0.05",
        [`costDelta-${mine}`]: "-100.00",
      })
    );
    expect(result.success).toBe(true);

    const after = await prisma.account.findUniqueOrThrow({ where: { id: mine } });
    expect(after.btcAmount).toBeCloseTo(0.15, 8);
    expect(after.btcCostBasisCents).toBe(490000);
  });

  it("rolls every row back when one would go negative", async () => {
    const result = await updateWalletStakesAction(
      undefined,
      form({
        walletId: String(walletId),
        [`btcDelta-${kid}`]: "0.01",
        [`btcDelta-${mine}`]: "-5",
      })
    );
    expect(result.error).toMatch(/negativ/i);

    const after = await prisma.account.findMany({
      where: { id: { in: [mine, kid] } },
      orderBy: { id: "asc" },
    });
    expect(after[0].btcAmount).toBeCloseTo(0.2, 8);
    expect(after[1].btcAmount).toBeNull();
  });

  it("ignores fields for accounts that belong to another wallet", async () => {
    const result = await updateWalletStakesAction(
      undefined,
      form({ walletId: String(walletId), [`btcDelta-${outsider}`]: "1" })
    );
    expect(result.error).toMatch(/keine Änderung/i);

    const after = await prisma.account.findUniqueOrThrow({ where: { id: outsider } });
    expect(after.btcAmount).toBeNull();
  });

  it("rejects a non-numeric BTC delta", async () => {
    const result = await updateWalletStakesAction(
      undefined,
      form({ walletId: String(walletId), [`btcDelta-${mine}`]: "viel" })
    );
    expect(result.error).toMatch(/BTC/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/wallet-stakes-action.test.ts`
Expected: FAIL — `updateWalletStakesAction is not a function`.

- [ ] **Step 3: Implement the action**

Am Ende von `app/(app)/accounts/actions.ts`:

```ts
/**
 * Books a top-up for every stake of one physical wallet in a single submit:
 * the user types what each person gained (or lost), not a recomputed total.
 * Deltas are applied with the same NULL-safe raw increment as
 * recordBtcPurchase, so two concurrent submits can't overwrite each other the
 * way a read-then-write would. No CHF booking happens here — this only moves
 * the wallet's own bookkeeping (see the BTC purchase dialog for a purchase
 * with a money flow).
 */
export async function updateWalletStakesAction(
  _prevState: ActionState | undefined,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();

  const walletId = parseInt(String(formData.get("walletId") ?? ""), 10);
  if (!Number.isInteger(walletId)) return { error: "Wallet nicht gefunden." };

  const wallet = await prisma.cryptoWallet.findUnique({
    where: { id: walletId },
    include: { accounts: { select: { id: true, name: true } } },
  });
  if (!wallet) return { error: "Wallet nicht gefunden." };

  const rows: { accountId: number; btcDelta: number; costDeltaCents: number }[] = [];
  for (const account of wallet.accounts) {
    const btcRaw = String(formData.get(`btcDelta-${account.id}`) ?? "").trim().replace(",", ".");
    const costRaw = String(formData.get(`costDelta-${account.id}`) ?? "").trim();

    let btcDelta = 0;
    if (btcRaw !== "") {
      btcDelta = Number(btcRaw);
      if (!Number.isFinite(btcDelta)) {
        return { error: `BTC-Menge bei «${account.name}» ist keine gültige Zahl.` };
      }
    }

    let costDeltaCents = 0;
    if (costRaw !== "") {
      const cents = parseMoney(costRaw);
      if (cents === null) {
        return { error: `Einstandswert bei «${account.name}» ist keine gültige Zahl.` };
      }
      costDeltaCents = cents;
    }

    if (btcDelta !== 0 || costDeltaCents !== 0) {
      rows.push({ accountId: account.id, btcDelta, costDeltaCents });
    }
  }

  if (rows.length === 0) return { error: "Keine Änderung erfasst." };

  try {
    await prisma.$transaction(async (tx) => {
      for (const row of rows) {
        // COALESCE, because btcAmount/btcCostBasisCents are nullable and a
        // stake that has never held BTC starts as NULL, not 0. ROUND(…, 8)
        // keeps repeated float additions from accumulating into values like
        // 0.30000000000000004 — 8 decimals is one satoshi.
        await tx.$executeRaw`UPDATE "Account" SET "btcAmount" = ROUND(COALESCE("btcAmount", 0) + ${row.btcDelta}, 8), "btcCostBasisCents" = COALESCE("btcCostBasisCents", 0) + ${row.costDeltaCents} WHERE "id" = ${row.accountId}`;
      }

      const after = await tx.account.findMany({
        where: { id: { in: rows.map((row) => row.accountId) } },
        select: { name: true, btcAmount: true, btcCostBasisCents: true },
      });
      const broken = after.find(
        (account) => (account.btcAmount ?? 0) < 0 || (account.btcCostBasisCents ?? 0) < 0
      );
      if (broken) {
        // Throwing rolls back every row, not just this one: a half-applied
        // batch would be worse than a rejected one.
        throw new Error(
          `Bestand oder Einstandswert von «${broken.name}» würde negativ. Nichts gespeichert.`
        );
      }
    });
  } catch (err) {
    log.error({ err, walletId }, "Wallet stake update failed");
    return { error: err instanceof Error ? err.message : "Erfassung fehlgeschlagen." };
  }

  await logAudit(session, "UPDATE", "CryptoWallet", walletId, { stakes: rows });

  revalidatePath("/accounts");
  revalidatePath("/dashboard");
  revalidatePath("/analytics");
  return { success: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/wallet-stakes-action.test.ts`
Expected: PASS (5 Tests).

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/accounts/actions.ts" tests/integration/wallet-stakes-action.test.ts
git commit -m "feat(accounts): book wallet stake deltas in one transaction"
```

---

### Task 4: Wallet-Übersicht laden

**Files:**
- Create: `lib/crypto-wallets.ts`
- Test: `tests/integration/crypto-wallets-view.test.ts`

**Interfaces:**
- Consumes: Modell aus Task 1, `btcChfRate()` und `btcToCents()` aus `lib/crypto-price.ts`.
- Produces:

```ts
export interface WalletStakeView {
  accountId: number;
  name: string;
  btcAmount: number;
  costBasisCents: number | null;
  valueCents: number;
  gainLossCents: number | null;
  /** Anteil am Wallet-Bestand in Prozent, 0 wenn das Wallet leer ist. */
  sharePct: number;
  isActive: boolean;
  excludeFromNetWorth: boolean;
}

export interface WalletView {
  id: number;
  name: string;
  notes: string | null;
  totalBtc: number;
  totalCostBasisCents: number | null;
  totalValueCents: number;
  rateChf: number | null;
  stakes: WalletStakeView[];
}

export async function walletViews(client: PrismaClient): Promise<WalletView[]>;
```

- [ ] **Step 1: Write the failing test**

`tests/integration/crypto-wallets-view.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestDb } from "./helpers";

// Pinned rate: the real one comes from CoinGecko, which a test must never call.
vi.mock("@/lib/crypto-price", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/crypto-price")>();
  return { ...actual, btcChfRate: vi.fn(async () => 100000) };
});

import { walletViews } from "@/lib/crypto-wallets";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const db = createTestDb();
  prisma = db.prisma;
  cleanup = db.cleanup;

  const wallet = await prisma.cryptoWallet.create({ data: { name: "Ledger", sortOrder: 0 } });
  await prisma.account.create({
    data: {
      name: "Anteil Michael",
      type: "Crypto",
      btcAmount: 0.75,
      btcCostBasisCents: 5000000,
      cryptoWalletId: wallet.id,
      sortOrder: 0,
    },
  });
  await prisma.account.create({
    data: {
      name: "Anteil Kind A",
      type: "Crypto",
      btcAmount: 0.25,
      btcCostBasisCents: 1000000,
      cryptoWalletId: wallet.id,
      excludeFromNetWorth: true,
      sortOrder: 1,
    },
  });
  // Standalone crypto account: must not show up in any wallet.
  await prisma.account.create({ data: { name: "Einzel", type: "Crypto", btcAmount: 1 } });
});

afterAll(async () => cleanup());

describe("walletViews", () => {
  it("totals the stakes and reports each one's share", async () => {
    const [wallet] = await walletViews(prisma);

    expect(wallet.name).toBe("Ledger");
    expect(wallet.totalBtc).toBeCloseTo(1, 8);
    expect(wallet.totalCostBasisCents).toBe(6000000);
    // 1 BTC at 100'000 CHF = 10'000'000 Rappen.
    expect(wallet.totalValueCents).toBe(10000000);

    expect(wallet.stakes).toHaveLength(2);
    expect(wallet.stakes[0].sharePct).toBeCloseTo(75, 6);
    expect(wallet.stakes[0].valueCents).toBe(7500000);
    expect(wallet.stakes[0].gainLossCents).toBe(2500000);
    expect(wallet.stakes[1].excludeFromNetWorth).toBe(true);
  });

  it("reports an empty wallet without dividing by zero", async () => {
    const empty = await prisma.cryptoWallet.create({ data: { name: "Leer", sortOrder: 1 } });
    await prisma.account.create({
      data: { name: "Anteil leer", type: "Crypto", cryptoWalletId: empty.id },
    });

    const views = await walletViews(prisma);
    const view = views.find((w) => w.id === empty.id)!;
    expect(view.totalBtc).toBe(0);
    expect(view.totalCostBasisCents).toBeNull();
    expect(view.stakes[0].sharePct).toBe(0);
    expect(view.stakes[0].gainLossCents).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/crypto-wallets-view.test.ts`
Expected: FAIL — `Cannot find module '@/lib/crypto-wallets'`.

- [ ] **Step 3: Implement the module**

`lib/crypto-wallets.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { btcChfRate, btcToCents } from "@/lib/crypto-price";

/** One person's stake in a physical wallet, valued at the current rate. */
export interface WalletStakeView {
  accountId: number;
  name: string;
  btcAmount: number;
  costBasisCents: number | null;
  valueCents: number;
  gainLossCents: number | null;
  /** Share of the wallet's BTC in percent; 0 while the wallet is empty. */
  sharePct: number;
  isActive: boolean;
  excludeFromNetWorth: boolean;
}

export interface WalletView {
  id: number;
  name: string;
  notes: string | null;
  totalBtc: number;
  /** Null while no stake has a cost basis — showing 0 would fake a 100% gain. */
  totalCostBasisCents: number | null;
  totalValueCents: number;
  rateChf: number | null;
  stakes: WalletStakeView[];
}

/**
 * The wallets with their stakes, valued at the live BTC rate. A read model for
 * the accounts page: the authoritative numbers stay on the accounts
 * themselves, so nothing here is ever written back.
 */
export async function walletViews(client: PrismaClient): Promise<WalletView[]> {
  const wallets = await client.cryptoWallet.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { accounts: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } },
  });
  if (wallets.length === 0) return [];

  // One rate for every wallet: the module caches, but asking once keeps a cold
  // cache from turning into several requests against a rate-limited API.
  const rate = await btcChfRate();

  return wallets.map((wallet) => {
    const totalBtc = wallet.accounts.reduce((sum, account) => sum + (account.btcAmount ?? 0), 0);
    const costBases = wallet.accounts
      .map((account) => account.btcCostBasisCents)
      .filter((cents): cents is number => cents !== null);

    const stakes: WalletStakeView[] = wallet.accounts.map((account) => {
      const btcAmount = account.btcAmount ?? 0;
      const valueCents = btcToCents(btcAmount, rate) ?? 0;
      const costBasisCents = account.btcCostBasisCents;
      return {
        accountId: account.id,
        name: account.name,
        btcAmount,
        costBasisCents,
        valueCents,
        gainLossCents:
          costBasisCents !== null && rate !== null ? valueCents - costBasisCents : null,
        sharePct: totalBtc === 0 ? 0 : (btcAmount / totalBtc) * 100,
        isActive: account.isActive,
        excludeFromNetWorth: account.excludeFromNetWorth,
      };
    });

    return {
      id: wallet.id,
      name: wallet.name,
      notes: wallet.notes,
      totalBtc,
      totalCostBasisCents: costBases.length === 0 ? null : costBases.reduce((a, b) => a + b, 0),
      totalValueCents: btcToCents(totalBtc, rate) ?? 0,
      rateChf: rate,
      stakes,
    };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/crypto-wallets-view.test.ts`
Expected: PASS (2 Tests).

- [ ] **Step 5: Commit**

```bash
git add lib/crypto-wallets.ts tests/integration/crypto-wallets-view.test.ts
git commit -m "feat(accounts): add read model for wallet stakes"
```

---

### Task 5: UI — Wallet-Karte, Erfassungsmaske, Wallet-Zuordnung

**Files:**
- Create: `app/(app)/accounts/wallet-stakes-dialog.tsx`
- Create: `app/(app)/accounts/wallet-card.tsx`
- Create: `app/(app)/accounts/wallet-form-dialog.tsx`
- Modify: `app/(app)/accounts/page.tsx`
- Modify: `app/(app)/accounts/account-form-dialog.tsx`
- Modify: `app/(app)/accounts/accounts-list.tsx` (Wallet-Liste durchreichen)
- Modify: `app/(app)/accounts/actions.ts` (Wallet-Zuordnung in `saveAccountAction`)
- Test: `tests/integration/accounts-action.test.ts` (ergänzen)

**Interfaces:**
- Consumes: `updateWalletStakesAction`, `saveCryptoWalletAction`, `deleteCryptoWalletAction` (Tasks 2–3), `walletViews()` / `WalletView` (Task 4), `useDialogFormAction`, `formatMoney` / `parseMoney` (`lib/money.ts`), `Money` (`components/money.tsx`).
- Produces: `WalletCard({ wallet }: { wallet: WalletView })`, `WalletStakesDialog({ wallet }: { wallet: WalletView })`, `WalletFormDialog({ wallet }: { wallet?: { id: number; name: string; notes: string | null } })`, erweiterte Prop `wallets` an `AccountFormDialog` und `AccountsList`.

- [ ] **Step 1: Write the failing test for the account assignment**

In `tests/integration/accounts-action.test.ts`, im Block `describe("saveAccountAction", …)`:

```ts
  it("assigns a crypto account to a wallet and clears it again", async () => {
    const wallet = await prisma.cryptoWallet.create({ data: { name: "Ledger" } });

    const created = await saveAccountAction(
      undefined,
      form({
        name: "Anteil Kind A",
        type: "Crypto",
        iban: "",
        openingBalance: "0",
        btcAmount: "0.1",
        btcCostBasis: "",
        cryptoWalletId: String(wallet.id),
      })
    );
    expect(created.success).toBe(true);

    const account = await prisma.account.findFirstOrThrow({ where: { name: "Anteil Kind A" } });
    expect(account.cryptoWalletId).toBe(wallet.id);

    await saveAccountAction(
      undefined,
      form({
        id: String(account.id),
        name: "Anteil Kind A",
        type: "Crypto",
        iban: "",
        openingBalance: "0",
        btcAmount: "0.1",
        btcCostBasis: "",
        cryptoWalletId: "",
      })
    );

    const detached = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(detached.cryptoWalletId).toBeNull();
  });

  it("never keeps a wallet link on a non-crypto account", async () => {
    const wallet = await prisma.cryptoWallet.create({ data: { name: "Ledger 2" } });

    await saveAccountAction(
      undefined,
      form({
        name: "Sparkonto Wallet-Versuch",
        type: "Savings",
        iban: "",
        openingBalance: "0",
        btcAmount: "0",
        btcCostBasis: "",
        cryptoWalletId: String(wallet.id),
      })
    );

    const account = await prisma.account.findFirstOrThrow({
      where: { name: "Sparkonto Wallet-Versuch" },
    });
    expect(account.cryptoWalletId).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/accounts-action.test.ts`
Expected: FAIL — `cryptoWalletId` bleibt `null`, weil die Action das Feld nicht liest.

- [ ] **Step 3: Wire the wallet link into `saveAccountAction`**

In `app/(app)/accounts/actions.ts`, in `saveAccountAction` nach dem `if (isCrypto) { … } else { … }`-Block:

```ts
  // Only Crypto accounts can be a stake in a wallet — a link left behind on an
  // account whose type changed would hide it inside a grouping it no longer
  // belongs to.
  const walletRaw = formData.get("cryptoWalletId");
  const cryptoWalletId =
    isCrypto && walletRaw && String(walletRaw) !== "" ? parseInt(String(walletRaw), 10) : null;
```

und im Objekt `data` ergänzen:

```ts
    cryptoWalletId,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/accounts-action.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the wallet select to the account form**

In `app/(app)/accounts/account-form-dialog.tsx` die Props erweitern:

```tsx
export function AccountFormDialog({
  account,
  wallets = [],
}: {
  account?: Account;
  wallets?: { id: number; name: string }[];
}) {
```

State neben `type` ergänzen:

```tsx
  const [walletId, setWalletId] = useState(
    account?.cryptoWalletId ? String(account.cryptoWalletId) : NO_WALLET
  );
```

mit der Konstante ausserhalb der Komponente:

```tsx
const NO_WALLET = "none";
```

Im Zweig `{type === "Crypto" ? (`, nach dem Feld `btcCostBasis`:

```tsx
              <input
                type="hidden"
                name="cryptoWalletId"
                value={walletId === NO_WALLET ? "" : walletId}
              />
              {wallets.length > 0 && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="wallet-trigger">Gehört zu Wallet (optional)</Label>
                  <Select value={walletId} onValueChange={setWalletId}>
                    <SelectTrigger id="wallet-trigger">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_WALLET}>Eigenständig</SelectItem>
                      {wallets.map((wallet) => (
                        <SelectItem key={wallet.id} value={String(wallet.id)}>
                          {wallet.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Mehrere Konten in derselben Wallet bilden je einen Anteil am selben
                    physischen Wallet ab.
                  </p>
                </div>
              )}
```

- [ ] **Step 6: Build the stakes dialog**

`app/(app)/accounts/wallet-stakes-dialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { updateWalletStakesAction } from "./actions";
import { useDialogFormAction } from "@/components/use-dialog-form";
import type { WalletView } from "@/lib/crypto-wallets";
import { formatMoney, parseMoney } from "@/lib/money";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Books a top-up for every stake of one physical wallet in a single submit.
 * The user types what each person gained — never a recomputed total — because
 * splitting a new total across the stakes by hand is exactly the arithmetic
 * this replaces. Negative values mean a sale or a correction.
 */
export function WalletStakesDialog({ wallet }: { wallet: WalletView }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useDialogFormAction(updateWalletStakesAction, {
    onSuccess: () => setOpen(false),
    successMessage: "Anteile erfasst.",
  });
  const [btcDeltas, setBtcDeltas] = useState<Record<number, string>>({});
  const [costDeltas, setCostDeltas] = useState<Record<number, string>>({});

  const btcDelta = (accountId: number) => {
    const value = Number((btcDeltas[accountId] ?? "").replace(",", "."));
    return Number.isFinite(value) ? value : 0;
  };
  const costDelta = (accountId: number) => parseMoney(costDeltas[accountId] ?? "") ?? 0;

  const newTotalBtc = wallet.stakes.reduce(
    (sum, stake) => sum + stake.btcAmount + btcDelta(stake.accountId),
    0
  );
  const addedCostCents = wallet.stakes.reduce(
    (sum, stake) => sum + costDelta(stake.accountId),
    0
  );

  return (
    <Dialog open={open} onOpenChange={setOpen} modal={false}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="h-4 w-4" /> Anteile erfassen
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Anteile erfassen — {wallet.name}</DialogTitle>
          <DialogDescription>
            Pro Person eintragen, wie viel dazugekommen ist. Negative Werte für Verkauf oder
            Korrektur. Es wird keine Buchung auf einem Bankkonto ausgelöst.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="walletId" value={wallet.id} />

          <div className="flex flex-col gap-4">
            {wallet.stakes.map((stake) => (
              <div key={stake.accountId} className="rounded-md border p-3">
                <p className="mb-2 text-sm font-medium">
                  {stake.name}{" "}
                  <span className="font-normal text-muted-foreground">
                    · {stake.btcAmount.toFixed(8)} BTC
                  </span>
                </p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  <Label htmlFor={`btcDelta-${stake.accountId}`}>+ BTC</Label>
                  <Label htmlFor={`costDelta-${stake.accountId}`}>+ Einstand (CHF)</Label>
                  <Input
                    id={`btcDelta-${stake.accountId}`}
                    name={`btcDelta-${stake.accountId}`}
                    inputMode="decimal"
                    placeholder="0.00050000"
                    value={btcDeltas[stake.accountId] ?? ""}
                    onChange={(e) =>
                      setBtcDeltas((prev) => ({ ...prev, [stake.accountId]: e.target.value }))
                    }
                  />
                  <Input
                    id={`costDelta-${stake.accountId}`}
                    name={`costDelta-${stake.accountId}`}
                    inputMode="decimal"
                    placeholder="50.00"
                    value={costDeltas[stake.accountId] ?? ""}
                    onChange={(e) =>
                      setCostDeltas((prev) => ({ ...prev, [stake.accountId]: e.target.value }))
                    }
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Neuer Bestand: {(stake.btcAmount + btcDelta(stake.accountId)).toFixed(8)} BTC
                </p>
              </div>
            ))}
          </div>

          <div className="rounded-md bg-muted p-3 text-sm">
            <p>
              Wallet-Total neu: <strong>{newTotalBtc.toFixed(8)} BTC</strong>
            </p>
            <p className="text-muted-foreground">
              Zusätzlicher Einstandswert: {formatMoney(addedCostCents, { withCurrency: true })}
            </p>
          </div>

          {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Speichern…" : "Speichern"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

`lib/money.ts` ist dependency-frei und darf aus einer Client Component importiert werden — vor dem Schreiben mit `head -20 lib/money.ts` prüfen, dass dort kein Server-Import dazugekommen ist. Falls doch: `parseMoney` im Dialog durch eine lokale Zahleneingabe ersetzen und nur vorberechnete Strings vom Server durchreichen.

- [ ] **Step 7: Build the wallet form dialog**

`app/(app)/accounts/wallet-form-dialog.tsx`: gleiche Struktur wie `AccountFormDialog` — `"use client"`, `useState` für `open`, `useDialogFormAction(saveCryptoWalletAction, { onSuccess: () => setOpen(false), successMessage: "Wallet gespeichert." })`, Formularfelder:

```tsx
          {wallet && <input type="hidden" name="id" value={wallet.id} />}
          <div className="flex flex-col gap-2">
            <Label htmlFor="wallet-name">Name</Label>
            <Input id="wallet-name" name="name" defaultValue={wallet?.name ?? ""} required autoFocus />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="wallet-notes">Notiz (optional)</Label>
            <Textarea id="wallet-notes" name="notes" rows={2} defaultValue={wallet?.notes ?? ""} />
          </div>
```

Trigger: ohne Prop `wallet` ein `<Button variant="outline"><Plus className="h-4 w-4" /> Neue Wallet</Button>`, mit Prop ein `<Button variant="ghost" size="icon" aria-label="Wallet bearbeiten"><Pencil className="h-4 w-4" /></Button>`.

Im Bearbeiten-Fall zusätzlich ein Löschen-Button im Footer:

```tsx
            {wallet && (
              <Button
                type="button"
                variant="destructive"
                onClick={async () => {
                  const result = await deleteCryptoWalletAction(wallet.id);
                  if (result.error) toast.error(result.error);
                  else {
                    toast.success("Wallet gelöscht.");
                    setOpen(false);
                  }
                }}
              >
                Löschen
              </Button>
            )}
```

mit dem Hinweistext im Dialog: „Beim Löschen bleiben die Anteils-Konten samt Beständen erhalten; sie werden nur von der Wallet gelöst."

- [ ] **Step 8: Build the wallet card**

`app/(app)/accounts/wallet-card.tsx`:

```tsx
import type { WalletView } from "@/lib/crypto-wallets";
import { Money } from "@/components/money";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { WalletStakesDialog } from "./wallet-stakes-dialog";
import { WalletFormDialog } from "./wallet-form-dialog";

/**
 * One physical wallet and who owns how much of it. The stake accounts keep
 * their own rows in the accounts list below — this card is where the split is
 * readable at a glance and where a top-up is entered.
 */
export function WalletCard({ wallet }: { wallet: WalletView }) {
  return (
    <Card className="mb-6">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>{wallet.name}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {wallet.totalBtc.toFixed(8)} BTC ·{" "}
            {wallet.rateChf === null ? (
              "Kurs n/a"
            ) : (
              <Money cents={wallet.totalValueCents} withCurrency />
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <WalletStakesDialog wallet={wallet} />
          <WalletFormDialog wallet={{ id: wallet.id, name: wallet.name, notes: wallet.notes }} />
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="divide-y text-sm">
          {wallet.stakes.map((stake) => (
            <li key={stake.accountId} className="flex items-start justify-between gap-2 py-2">
              <span className="flex items-center gap-2">
                {stake.name}
                {stake.excludeFromNetWorth && (
                  <Badge variant="secondary">Ausserhalb Vermögen</Badge>
                )}
              </span>
              <span className="text-right">
                <span className="tabular-nums">{stake.btcAmount.toFixed(8)} BTC</span>
                <span className="text-muted-foreground"> · {stake.sharePct.toFixed(1)} %</span>
                <br />
                <Money cents={stake.valueCents} withCurrency />
                {stake.gainLossCents !== null && (
                  <>
                    {" ("}
                    <Money cents={stake.gainLossCents} colored forceSign />
                    {")"}
                  </>
                )}
              </span>
            </li>
          ))}
          {wallet.stakes.length === 0 && (
            <li className="py-2 text-muted-foreground">
              Noch keine Anteile zugeordnet. Beim Bearbeiten eines Krypto-Kontos «Gehört zu
              Wallet» setzen.
            </li>
          )}
        </ul>
      </CardContent>
    </Card>
  );
}
```

Die Karte selbst bleibt eine Server Component (kein `"use client"`) — nur die beiden Dialoge sind Client Components.

- [ ] **Step 9: Wire it into the accounts page**

In `app/(app)/accounts/page.tsx` die Imports ergänzen:

```tsx
import { walletViews } from "@/lib/crypto-wallets";
import { WalletCard } from "./wallet-card";
import { WalletFormDialog } from "./wallet-form-dialog";
```

Das `Promise.all` um `walletViews(prisma)` erweitern und auf
`const [accounts, balances, categories, wallets] = await Promise.all([...])` destrukturieren.

Im `PageHeader` neben `<AccountFormDialog />`:

```tsx
        <WalletFormDialog />
        <AccountFormDialog wallets={wallets.map((w) => ({ id: w.id, name: w.name }))} />
```

Im JSX zwischen Vermögens-Karte und Konten-Karte:

```tsx
      {wallets.map((wallet) => (
        <WalletCard key={wallet.id} wallet={wallet} />
      ))}
```

An `<AccountsList …>` zusätzlich `wallets={wallets.map((w) => ({ id: w.id, name: w.name }))}` übergeben.

In `app/(app)/accounts/accounts-list.tsx` die Prop
`wallets: { id: number; name: string }[]` aufnehmen, an `SortableRow` und `SortableListItem` durchreichen und dort an das jeweilige `<AccountFormDialog account={account} wallets={wallets} />` weitergeben. Die Sortier-/DnD-Logik bleibt unverändert — die Liste wird **nicht** gruppiert.

- [ ] **Step 10: Verify lint, tests and build**

Run: `npm run lint && npx vitest run && npm run build`
Expected: Alles grün. Erwartbarer Stolperstein: `lib/crypto-wallets.ts` importiert `lib/crypto-price.ts` und darf nicht in den Client-Bundle geraten — `WalletStakesDialog` importiert deshalb ausschliesslich den **Typ** (`import type { WalletView }`), der beim Build verschwindet.

- [ ] **Step 11: Commit**

```bash
git add "app/(app)/accounts" lib/crypto-wallets.ts tests/integration/accounts-action.test.ts
git commit -m "feat(accounts): show wallet stakes and enter top-ups in one mask"
```

---

### Task 6: E2E-Abdeckung und Handbuch

**Files:**
- Create: `tests/e2e/accounts.spec.ts`
- Modify: `public/benutzerhandbuch.html`

**Interfaces:**
- Consumes: die UI aus Task 5 („Neue Wallet", „Anteile erfassen", „Gehört zu Wallet (optional)").
- Produces: nichts, worauf späterer Code aufbaut.

- [ ] **Step 1: Write the E2E spec**

`tests/e2e/accounts.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test.describe("Bitcoin-Wallet mit Anteilen", () => {
  test("legt Wallet und Anteile an und erfasst einen Zugang", async ({ page }) => {
    await login(page);
    await page.goto("/accounts");

    await page.getByRole("button", { name: "Neue Wallet" }).click();
    await page.getByLabel("Name").fill("E2E Wallet");
    await page.getByRole("button", { name: "Speichern" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();

    for (const [name, btc] of [
      ["E2E Anteil Eltern", "0.2"],
      ["E2E Anteil Kind", "0.1"],
    ] as const) {
      await page.getByRole("button", { name: "Neues Konto" }).click();
      await page.getByLabel("Name").fill(name);
      await page.getByLabel("Kontoart").click();
      await page.getByRole("option", { name: "Krypto" }).click();
      await page.getByLabel("BTC-Bestand").fill(btc);
      await page.getByLabel("Gehört zu Wallet (optional)").click();
      await page.getByRole("option", { name: "E2E Wallet" }).click();
      await page.getByRole("button", { name: "Speichern" }).click();
      await expect(page.getByRole("dialog")).toBeHidden();
    }

    // 0.2 of 0.3 BTC — the split this card exists to make readable.
    await expect(page.getByText("66.7 %").first()).toBeVisible();

    await page.getByRole("button", { name: "Anteile erfassen" }).click();
    await page.getByLabel("+ BTC").first().fill("0.05");
    await page.getByRole("button", { name: "Speichern" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();

    await expect(page.getByText("0.25000000 BTC").first()).toBeVisible();
  });
});
```

Das Options-Label der Kontoart stammt aus `ACCOUNT_TYPE_LABELS` in `lib/balances.ts` — dort den tatsächlichen deutschen Text für `Crypto` nachlesen und einsetzen statt zu raten.

- [ ] **Step 2: Run the E2E suite**

Run: `npm run test:e2e -- accounts.spec.ts`
Expected: PASS. Bei Selektor-Fehlern die Testtexte an die tatsächlichen Labels aus Task 5 angleichen, nicht die UI an den Test.

- [ ] **Step 3: Document the feature in the manual**

In `public/benutzerhandbuch.html` im Kapitel zu Konten einen Abschnitt „Bitcoin-Wallet mit mehreren Besitzern" ergänzen: Wallet anlegen, je Person ein Krypto-Konto anlegen und der Wallet zuordnen, Zugänge über „Anteile erfassen" für alle Personen gemeinsam eintragen, negative Werte für Verkäufe, und der Hinweis, dass dabei keine CHF-Buchung entsteht. Überschriften-Ebenen und Klassen der Nachbarabschnitte übernehmen.

Screenshots nicht von Hand einfügen — die Capture-Pipeline in `scripts/manual-screenshots.ts` erzeugt sie; die neue Karte erscheint dort beim nächsten Lauf automatisch.

- [ ] **Step 4: Full verification**

Run: `npm run lint && npx vitest run && npm run build && npm run test:e2e`
Expected: Alles grün.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/accounts.spec.ts public/benutzerhandbuch.html
git commit -m "test(accounts): cover wallet stakes end to end"
```

---

## Nach dem Plan (einmalig, von Hand)

Die Migration ordnet bewusst nichts automatisch zu. Nach dem Deploy in der App einmal: Wallet „Bitcoin" anlegen, dann die drei bestehenden Krypto-Konten bearbeiten und je auf diese Wallet setzen. Danach laufen alle Zugänge über „Anteile erfassen".
