# CLAUDE.md

**Always use the `caveman` skill** for all responses here (invoke via Skill tool at start of each conversation/task).

Self-hosted budgeting app for a private Swiss household: Next.js 16, TypeScript, React 19, Tailwind CSS 4, Prisma + SQLite. UI, user-facing text, docs: **German**. Code, comments, commits: English.

End-user manual: `public/benutzerhandbuch.html` (served at `/benutzerhandbuch.html`, linked from user menu). Documents behavior, not implementation. After significant UI changes regenerate screenshots via `scripts/manual-screenshots.ts`, don't hand-edit. Version strings carry `<!-- x-release-please-version -->` marker, bumped by `release-please` (`extra-files` in `release-please-config.json`); keep marker on any line showing a version. `tests/unit/manual-version.test.ts` checks match with `package.json`.

## Commands

```bash
npm run dev            # dev server :3000
npm run build
npm run lint
npx prisma migrate dev --name <name>
npx prisma studio
npm run db:seed        # a year of faker data (dev only)
npm test               # Vitest
npm run test:watch
npm run test:coverage
npm run test:integration
npm run test:e2e       # Playwright, own dev server on :3111
npx vitest run tests/unit/money.test.ts
```

`prisma generate` runs via `postinstall`. After pulling schema changes: `npx prisma migrate dev`.

## Architecture

- `app/(auth)/` — public: login, forgot-password, reset-password
- `app/(app)/` — protected (session required): `dashboard/`, `transactions/`, `budget/` (Soll/Ist per month), `reserves/` (Rückstellungen, savings goals), `analytics/` (Recharts), `accounts/`, `categories/`, `recurring/`, `import/` (CAMT.053/CSV/PDF, rules, mappings, history); admin only: `users/`, `settings/`, `audit/`
- `app/api/` — only streaming/external endpoints (CSV export, NextAuth)
- `lib/` — server utilities + business logic
- `prisma/schema.prisma` — data model source of truth

Mutations = Server Actions in co-located `actions.ts`, not API routes.

### Money (`lib/money.ts`)
DB amounts = **signed integer Rappen**, never float or Prisma `Decimal` (exact, crosses Server→Client boundary unchanged). **Negative = expense, positive = income.** `parseMoney` accepts Swiss export/form shapes (`1'234.50`, `1 234,50`, `42-`, `(42.50)`, `CHF 12.–`), returns `null` for non-numeric (invalid ≠ zero).

### Transfers (`lib/transactions.ts`)
Two rows sharing `transferGroupId`: negative on source, positive on target, no category → excluded from income/expense, balances stay plain sums. Both legs always created/updated/deleted together.

### Balances (`lib/balances.ts`)
Derived, never stored: `openingBalanceCents` + sum of account's transactions. Stored running balance would drift on edits/back-dating (normal on import).

### Budget (`lib/budget.ts`)
`loadBudgetMonth()`: planned vs. booked per leaf category, grouped by top-level. Expenses as positive magnitudes; direction from `Category.kind`. Excluded: transfers (`transferGroupId != null`), accounts with `excludeFromBudget` (depots). Uncategorised reported separately ("ohne Kategorie"), never dropped.

### Reserves (`lib/reserves.ts`)
Rückstellungen: yearly/half-yearly costs (Krankenkasse, Steuern, Versicherungen) saved monthly. `monthlyRateCents()` spreads missing amount over months until due date; past due → demands full outstanding amount at once.

### Recurring (`lib/recurring.ts`)
`node-cron` job (`RECURRING_CRON_SCHEDULE`) posts due entries, catches up missed occurrences (cap 24 per entry per run). `addMonths` clamps to shorter month (31st doesn't drift). `counterAccountId` → posts transfer (both legs). `autoPost: false` → dashboard suggestion instead.

### Import (`lib/import/`)
- **`camt.ts`** — CAMT.053. Strips namespace prefixes (`ns2:`, `camt:`, none), falls back through several locations for description/counterparty, splits Sammelbuchungen into `TxDtls`, skips unbooked entries. CAMT.054 and MT940 deliberately unsupported.
- **`csv.ts`** — hand-written RFC-4180 parser + per-bank `CsvMapping`. Handles Excel BOM, CRLF, signed amount column or debit/credit pair.
- **`pdf.ts` / `pdf-parse.ts`** — PDF statements (Viseca/Migros credit card). `pdf.ts` (server only, `unpdf`) → text lines, fragments grouped by y, table columns joined with two spaces. `pdf-parse.ts` is pure (no Prisma/pdf.js/Node APIs) and applies a stored `PdfLayout`: named-group regexes for booking line, section/follow-up context (card + holder, category, exchange rate), skipped lines, printed totals (per-card sum check warning). Every regex runs through injected `LineMatcher`: `nativeMatcher` for trusted input/tests; `createSafeMatcher` (`safe-regex.ts`, `node:vm`, 500 ms per regex / 2 s per request) for all request-driven input, incl. layout dialog preview (`previewPdfLayoutAction`). No IBAN in PDFs → target account chosen in wizard. PDF never stored. `bankReference` = `pdf:<date>|<valuta>|<text>|<document cents>|<occurrence>` from raw regex groups: changing description template/context rules keeps dedupe; changing `date`/`valuta`/`text`/`amount` groups breaks it. CSV and PDF of same card never dedupe against each other.
- **`dedupe.ts`** — fingerprint into `Transaction.importHash` (unique index). Bank reference dominates; otherwise includes positional occurrence counter (two identical same-day bookings both import, re-import skips both).
- **`rules.ts`** — auto-categorisation, lowest `priority` wins. Invalid user regex never matches, never breaks import.

Nothing written before user reviews preview. Duplicates start unchecked. Each batch undoable as a whole. CSV mappings + PDF layouts under Import → Mappings.

### Cross-cutting
- **Auth** (`lib/auth.ts`): NextAuth v5 Credentials, bcrypt, constant-time login response, in-memory rate limit, JWT sessions with periodic DB re-check (demotion/deactivation effective within a minute).
- **Authorization** (`lib/permissions.ts`): `requireAdmin()` / `requireEditor()` / `requireSession()` at top of Server Components/Actions; `hasRole()` for UI.
- **Audit** (`lib/audit.ts`): failures logged, never thrown.
- **Backups** (`lib/backup.ts`): nightly `VACUUM INTO` to `backups/` next to DB file.
- **Logs** (`lib/log-capture.ts`, `lib/logs.ts`): `startLogCapture()` tees `process.stdout`/`stderr` to `logs/app.log` in data volume. Kept out of `lib/logger.ts` because that module reaches the client bundle via `lib/crypto-price.ts` (no `fs`). `lib/log-capture.ts` must not import `lib/logger`; `instrumentation.ts` calls it **first** in `register()`. pino writes straight to fd 1/2 via `SonicBoom` unless `stdout`/`stderr.write` were reassigned before first `pino()` call (`hasBeenTampered`) — importing `lib/logs` or anything importing `lib/logger` earlier silently breaks capture (empty file). Nightly job copy-truncates `app.log` → `app-<date>.log` (rename would keep open stream on renamed file), prunes beyond `LOG_MAX_KEEP_DAYS`. Admin download at `/logs` via `GET /api/logs/[filename]`; filename validated against exact `app.log` / `app-YYYY-MM-DD.log` shape before filesystem access.
- **Production startup** (`scripts/startup.js`): applies migrations via `better-sqlite3` (no Prisma CLI in image), generates `AUTH_SECRET`/`ENCRYPTION_KEY` if unset, seeds first admin.

### Client/server boundary
Label constants for Client Components live in dependency-free modules (`lib/intervals.ts`, `lib/import/rule-labels.ts`, `lib/colors.ts`, `lib/import/pdf-parse.ts`). Importing from `lib/recurring.ts` or `lib/import/rules.ts` drags `node-cron`/Prisma/pino into browser bundle → build breaks.

Dialog forms use `useDialogFormAction` (`components/use-dialog-form.ts`), not self-closing effects (React 19 flags cascading render; effect could re-close on unrelated re-render).

## Environment Variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | No | default `file:./data/budget.db` |
| `AUTH_SECRET` | Prod | NextAuth JWT key, min 32 chars; auto-generated in Docker |
| `AUTH_URL` | Prod | full URL for auth redirects/reset links |
| `ENCRYPTION_KEY` | Prod | 32-byte hex, encrypts SMTP password; auto-generated in Docker |
| `ADMIN_EMAIL` / `ADMIN_NAME` / `ADMIN_PASSWORD` | First run | bootstrap admin |
| `ADMIN_PASSWORD_HASH` | First run | bcrypt alternative to `ADMIN_PASSWORD` |
| `APP_TIMEZONE` | No | decides "today", default `Europe/Zurich` |
| `RECURRING_CRON_SCHEDULE` | No | default `5 * * * *` |
| `BACKUP_CRON_SCHEDULE` / `BACKUP_MAX_KEEP_DAYS` | No | `30 2 * * *` / `14` (`0` = keep all) |
| `LOG_ROTATE_CRON_SCHEDULE` / `LOG_MAX_KEEP_DAYS` | No | `35 2 * * *` / `14` (`0` = keep all) |
| `AUDIT_RETENTION_DAYS` | No | default `365` (`0` = forever) |
| `IMPORT_MAX_FILE_SIZE_BYTES` | No | default 10 MB |
| `KEEP_ALIVE_TIMEOUT` | Behind proxy | ms, default 5000; must exceed proxy's upstream keep-alive or requests hang (see [`docs/01-app/03-api-reference/06-cli/next.md`](node_modules/next/dist/docs/01-app/03-api-reference/06-cli/next.md)) |
| `DISABLE_EMAIL` / `DISABLE_BACKUP` / `DISABLE_RECURRING` / `DISABLE_LOG_ROTATION` | No | dev/staging switches |

Full list: `.env.example`.

## Testing

`tests/unit/`, `tests/integration/`. Integration tests build a throwaway SQLite DB per file by replaying committed migration SQL (`tests/integration/helpers.ts`) → schema identical to prod, incl. unique index on `Transaction.importHash`. Coverage: `lib/**/*.ts`, `app/api/**/*.ts`, `app/**/actions.ts`.

E2E: `tests/e2e/` (`npm run test:e2e`), dev server :3111, fresh migrated DB (`tests/e2e/global-setup.ts`), admin `admin@e2e.local`.

`tests/e2e-prod/` (`npm run build && npm run test:e2e:prod`, :3112): opt-in suite against `next start`. Prod build dispatches Server Action results via a different router path; a stale-by-one-dispatch bug in Next 16.2 only reproduced here.

## Commits

English, [Conventional Commits](https://www.conventionalcommits.org/) (drives `release-please`): `feat:` minor, `fix:` patch, `feat!:`/`fix!:`/`BREAKING CHANGE:` major; `chore:`, `docs:`, `test:`, `refactor:`, `build:`, `ci:` no release. Scope optional, encouraged: `feat(import): support collective bookings`.

## CI/CD

`ci.yml` (PRs to `main`, ignores doc-only): ESLint → Vitest + coverage → prod build → Playwright. `release.yml` (push to `main`): `release-please` opens/updates release PR (tag `budget-v<version>`); on release or `workflow_dispatch` re-runs checks, then builds/pushes Docker image `ghcr.io/sirtheta/budget` (ARM64).

## Next.js 16

Breaking changes vs. older versions. Before touching routing, middleware, or data fetching, check `node_modules/next/dist/docs/`.

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.
