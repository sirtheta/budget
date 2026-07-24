# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

A self-hosted household budgeting app for a private Swiss household, implemented as a Next.js 16 web dashboard (TypeScript, React 19, Tailwind CSS 4, Prisma + SQLite).

The UI, user-facing text, and documentation are **in German**. Code, comments, and commit messages are in English.

---

## Web Application (repo root)

### Commands

```bash
# Development
npm run dev            # Start dev server at localhost:3000
npm run build          # Production build
npm run lint           # ESLint check

# Database
npx prisma migrate dev --name <name>   # Create and apply a new migration
npx prisma studio                       # GUI to inspect the DB
npm run db:seed                         # Seed a year of faker data (dev only)

# Tests
npm test               # Run all tests (Vitest)
npm run test:watch     # Watch mode
npm run test:coverage  # Coverage report (v8)
npm run test:integration  # Integration tests only
npm run test:e2e       # Playwright E2E tests (starts its own dev server on :3111)
# Run a single test file:
npx vitest run tests/unit/money.test.ts
```

> **Note:** `prisma generate` runs automatically via `postinstall`. After pulling schema changes, run `npx prisma migrate dev` to keep the local DB in sync.

### Architecture

**Next.js App Router layout:**

- `app/(auth)/` — Public routes (login, forgot-password, reset-password)
- `app/(app)/` — Protected routes; all require an active session
  - `dashboard/` — Month overview, balances, budget traffic lights, recent bookings
  - `transactions/` — Filterable booking list, entry form, transfers
  - `budget/` — Soll/Ist per category for one month
  - `reserves/` — Rückstellungen (provisions) and savings goals
  - `analytics/` — Yearly charts (Recharts)
  - `accounts/`, `categories/`, `recurring/` — Master data
  - `import/` — CAMT.053 / CSV import, rules, mappings, import history
  - `users/`, `settings/`, `audit/` — Admin only
- `app/api/` — Reserved for streaming/external endpoints (CSV export, NextAuth)
- `lib/` — Shared server-side utilities and business logic
- `prisma/schema.prisma` — Single source of truth for the data model

**Data mutations** use Next.js Server Actions (`actions.ts` files co-located with routes), not API routes.

### Money (`lib/money.ts`)

Every amount in the database is a **signed integer number of Rappen** — never a float, never a Prisma `Decimal`. Integers keep arithmetic exact and survive the Server-Component → Client-Component boundary unchanged, which a `Decimal` does not.

Sign convention throughout: **negative = expense, positive = income**.

`parseMoney` accepts the shapes that actually turn up in Swiss bank exports and form input (`1'234.50`, `1 234,50`, `42-`, `(42.50)`, `CHF 12.–`) and returns `null` for non-numeric input, so callers can tell "invalid" from "zero".

### Transfers (`lib/transactions.ts`)

A transfer between the household's own accounts is stored as **two rows sharing a `transferGroupId`**: negative on the source, positive on the target, both with no category. That is what keeps them out of every income/expense evaluation while each account's balance stays a plain sum of its own rows. Both legs are always created, updated, and deleted together.

### Balances (`lib/balances.ts`)

Balances are **derived**, never stored: `openingBalanceCents` plus the sum of the account's transactions. A stored running balance would drift the moment a transaction is edited or back-dated — and back-dating is the normal case when importing a statement.

### Budget (`lib/budget.ts`)

`loadBudgetMonth()` returns planned vs. booked per leaf category, grouped by top-level category. Expenses are reported as positive magnitudes so Soll and Ist are directly comparable; the direction comes from `Category.kind`.

Excluded from every evaluation: transfers (`transferGroupId != null`) and accounts flagged `excludeFromBudget` (depots). Uncategorised bookings are reported separately rather than dropped — a large "ohne Kategorie" figure is the signal the user needs.

### Reserves (`lib/reserves.ts`)

Rückstellungen cover costs that fall due yearly or half-yearly (Krankenkasse, Steuern, Versicherungen) but must be set aside monthly. Without the concept a Swiss household budget looks healthy for eleven months and collapses in the twelfth. `monthlyRateCents()` spreads what is still missing over the months until the due date; once the due date has passed it demands the full outstanding amount at once rather than understating the obligation.

### Recurring transactions (`lib/recurring.ts`)

A `node-cron` job (`RECURRING_CRON_SCHEDULE`, default hourly) posts due entries and **catches up occurrences missed while the app was down**, capped at 24 postings per entry and run. `addMonths` clamps to the shorter target month, so an entry booked on the 31st does not drift into the following month.

Entries with `counterAccountId` post a transfer (both legs); `autoPost: false` entries surface on the dashboard as a suggestion instead.

### Import (`lib/import/`)

- **`camt.ts`** — CAMT.053 parser. Strips namespace prefixes (banks emit `ns2:`, `camt:`, none), falls back through several locations for description and counterparty, splits collective bookings (`Sammelbuchungen`) into their individual `TxDtls`, and skips entries that are not yet booked. CAMT.054 and MT940 are deliberately not supported: .054 only avises credits, MT940 is the superseded SWIFT format.
- **`csv.ts`** — Hand-written RFC-4180 parser plus a per-bank column mapping (`CsvMapping`). Handles the BOM Excel writes, CRLF, and either one signed amount column or a debit/credit pair.
- **`dedupe.ts`** — Fingerprints each candidate into `Transaction.importHash` (unique index). The bank reference dominates when present; otherwise the hash includes a positional occurrence counter so two genuinely identical bookings on the same day both import, while re-importing the same file skips both.
- **`rules.ts`** — Auto-categorisation, lowest `priority` wins. An invalid user regex never matches instead of breaking the import.

Nothing is written until the user has reviewed the preview. Duplicates start unchecked, and each import batch can be undone as a whole.

**Authentication** (`lib/auth.ts`): NextAuth v5 Credentials provider, bcrypt, constant-time login response, in-memory rate limiting, JWT sessions with a periodic DB re-check so a demotion or deactivation takes effect within a minute.

**Authorization** (`lib/permissions.ts`): `requireAdmin()` / `requireEditor()` / `requireSession()` at the top of Server Components and Server Actions; `hasRole()` for UI rendering.

**Audit logging** (`lib/audit.ts`): failures are logged but never thrown, so a broken audit trail never blocks the underlying mutation.

**Backups** (`lib/backup.ts`): nightly `VACUUM INTO` snapshot to `backups/` next to the database file, inside the data volume.

**Production startup** (`scripts/startup.js`): applies pending migrations directly via `better-sqlite3` (no Prisma CLI in the image), generates `AUTH_SECRET`/`ENCRYPTION_KEY` if unset, and seeds the first admin.

### Client/server module boundary

Label constants used by Client Components live in dependency-free modules (`lib/intervals.ts`, `lib/import/rule-labels.ts`, `lib/colors.ts`). Importing them from `lib/recurring.ts` or `lib/import/rules.ts` instead would drag `node-cron`, Prisma, or pino into the browser bundle and break the build.

Dialog forms use `useDialogFormAction` (`components/use-dialog-form.ts`) rather than closing themselves from an effect — React 19 flags the cascading render, and the effect variant could close the dialog again on an unrelated re-render.

### Key Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | No | SQLite path, defaults to `file:./data/budget.db` |
| `AUTH_SECRET` | Production only | NextAuth JWT signing key (min 32 chars); auto-generated in Docker if unset |
| `AUTH_URL` | Production only | Full URL for auth redirects and reset links |
| `ENCRYPTION_KEY` | Production only | 32-byte hex key for encrypting the SMTP password at rest; auto-generated in Docker if unset |
| `ADMIN_EMAIL` / `ADMIN_NAME` / `ADMIN_PASSWORD` | First run | Bootstraps the initial admin user |
| `ADMIN_PASSWORD_HASH` | First run | Pre-hashed bcrypt alternative to `ADMIN_PASSWORD` |
| `APP_TIMEZONE` | No | IANA timezone deciding which calendar day is "today", defaults to `Europe/Zurich` |
| `RECURRING_CRON_SCHEDULE` | No | Cron expression for posting due recurring entries, defaults to `5 * * * *` |
| `BACKUP_CRON_SCHEDULE` / `BACKUP_MAX_KEEP_DAYS` | No | Nightly backup schedule (`30 2 * * *`) and retention (`14`, `0` = keep all) |
| `AUDIT_RETENTION_DAYS` | No | Days to keep audit rows (`0` = forever), default `365` |
| `IMPORT_MAX_FILE_SIZE_BYTES` | No | Upload guard for statement files, default 10 MB |
| `DISABLE_EMAIL` / `DISABLE_BACKUP` / `DISABLE_RECURRING` | No | Dev/staging switches |

See `.env.example` for the full list.

### Testing

Tests live in `tests/unit/` and `tests/integration/`. Integration tests build a throwaway SQLite database per file by replaying the committed migration SQL (`tests/integration/helpers.ts`), so the test schema is identical to production — including the unique index on `Transaction.importHash`. Coverage is collected for `lib/**/*.ts`, `app/api/**/*.ts` and `app/**/actions.ts`.

Playwright E2E tests live in `tests/e2e/` (`npm run test:e2e`): the config boots a dev server on port 3111 against a freshly migrated SQLite DB (`tests/e2e/global-setup.ts`, admin login `admin@e2e.local`).

---

## Commit Conventions

All commit messages must be **in English** and follow the [Conventional Commits](https://www.conventionalcommits.org/) spec, which `release-please` uses to determine version bumps and generate changelogs:

- `feat: <description>` — new feature — minor version bump
- `fix: <description>` — bug fix — patch version bump
- `feat!:` / `fix!:` or `BREAKING CHANGE:` footer — breaking change — major version bump
- `chore:`, `docs:`, `test:`, `refactor:`, `build:`, `ci:` — no release triggered

The scope is optional but encouraged, e.g. `feat(import): support collective bookings`.

---

## CI/CD

The **`web.yml`** GitHub Actions workflow triggers on pushes/PRs to `main` (ignoring doc-only changes). It runs ESLint, then Vitest with coverage, then a production build, then Playwright. On push to `main`, `release-please` opens/updates a release PR (tags as `budget-v<version>`); once a release is created (or on manual `workflow_dispatch`), the job builds and pushes a Docker image to `ghcr.io/sirtheta/budget` (ARM64 target).

---

## Next.js Version Note

This project uses **Next.js 16**, which has breaking changes from earlier versions. Before modifying routing, middleware, or data-fetching patterns, check `node_modules/next/dist/docs/` for current API conventions — do not assume behavior from older Next.js knowledge.
