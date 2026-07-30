import cron from "node-cron";
import Database from "better-sqlite3";
import { existsSync, mkdirSync, readdirSync, unlinkSync } from "fs";
import { dirname, join } from "path";
import type { PrismaClient } from "@prisma/client";
import logger from "@/lib/logger";
import { config } from "@/lib/config";
import { toDateString } from "@/lib/date";
import { getDbPath } from "@/lib/prisma";

const log = logger.child({ module: "backup" });

const globalForScheduler = globalThis as unknown as {
  backupSchedulerStarted?: boolean;
};

const BACKUP_FILE_RE = /^budget-backup-(\d{4}-\d{2}-\d{2})\.db$/;

export interface BackupOptions {
  /** SQLite file to back up; defaults to the DATABASE_URL path. */
  dbPath?: string;
  /** Target directory; defaults to `backups/` next to the database file. */
  backupDir?: string;
  /** Days to keep backup files; defaults to BACKUP_MAX_KEEP_DAYS. */
  maxKeepDays?: number;
  now?: Date;
}

/**
 * Tables a restorable snapshot must contain. Not the full schema — the point
 * is to catch a file that is empty, truncated, or the wrong file entirely,
 * not to re-implement migration checking.
 */
const REQUIRED_TABLES = ["User", "Account", "Transaction", "Category"];

export interface VerifyResult {
  ok: boolean;
  /** Human-readable reason, German (it is surfaced by scripts/restore.js). */
  error?: string;
}

/**
 * Checks that a backup file is actually restorable: readable as SQLite, not
 * corrupt, and carrying the schema.
 *
 * Worth doing eagerly rather than at restore time. A backup is only ever read
 * on the worst day of the installation's life, and a snapshot that turns out
 * to be a zero-byte file — because the disk filled up mid-`VACUUM INTO` — is
 * indistinguishable from a good one until then. Verifying at write time turns
 * that into a log line on an ordinary day.
 */
export function verifyBackup(path: string): VerifyResult {
  if (!existsSync(path)) return { ok: false, error: `Datei existiert nicht: ${path}` };

  let db: Database.Database | undefined;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });

    // `quick_check` over `integrity_check`: it skips the index cross-checks,
    // which on a household-sized database is the difference between instant
    // and merely fast, and still catches a truncated or corrupt file.
    const integrity = db.pragma("quick_check", { simple: true });
    if (integrity !== "ok") return { ok: false, error: `SQLite meldet: ${integrity}` };

    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    const present = new Set(rows.map((row) => row.name));
    const missing = REQUIRED_TABLES.filter((table) => !present.has(table));
    if (missing.length > 0) {
      return { ok: false, error: `Tabellen fehlen: ${missing.join(", ")}` };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    db?.close();
  }
}

/**
 * Writes a consistent snapshot of the live database via `VACUUM INTO` (one
 * file per calendar day; a same-day rerun replaces it) and prunes backups
 * older than the retention window. Returns the path of the written backup.
 *
 * The backup directory lives inside the data volume by default, so an
 * external sync of that directory (e.g. to a NAS) picks the backups up.
 *
 * The snapshot is verified before anything is pruned. Order matters: a run
 * that produced an unusable file must not be the run that deletes the last
 * good older backup.
 */
export async function runBackup(
  prisma: PrismaClient,
  options: BackupOptions = {}
): Promise<string> {
  const dbPath = options.dbPath ?? getDbPath();
  const backupDir = options.backupDir ?? join(dirname(dbPath), "backups");
  const now = options.now ?? new Date();

  mkdirSync(backupDir, { recursive: true });
  const target = join(backupDir, `budget-backup-${toDateString(now)}.db`);
  // VACUUM INTO refuses to overwrite an existing file.
  if (existsSync(target)) unlinkSync(target);
  await prisma.$executeRaw`VACUUM INTO ${target}`;

  const verified = verifyBackup(target);
  if (!verified.ok) {
    // Remove it: a file that is present but unrestorable is worse than none,
    // because it reads as a successful backup in the directory listing.
    unlinkSync(target);
    log.error({ target, reason: verified.error }, "Backup verification failed — backup discarded");
    throw new Error(`Backup verification failed: ${verified.error}`);
  }
  log.info({ target }, "Database backup written");

  pruneOldBackups(backupDir, options.maxKeepDays ?? config.backup.maxKeepDays, now);
  return target;
}

/** Deletes backup files older than `maxKeepDays` (0 = keep all). Returns the number deleted. */
export function pruneOldBackups(backupDir: string, maxKeepDays: number, now = new Date()): number {
  if (maxKeepDays <= 0) return 0;
  const cutoff = toDateString(new Date(now.getTime() - maxKeepDays * 86_400_000));
  let deleted = 0;
  for (const file of readdirSync(backupDir)) {
    const match = BACKUP_FILE_RE.exec(file);
    if (match && match[1] < cutoff) {
      unlinkSync(join(backupDir, file));
      deleted++;
    }
  }
  if (deleted > 0) log.info({ deleted, maxKeepDays }, "Pruned old backups");
  return deleted;
}

/** Starts the nightly backup cron job (BACKUP_CRON_SCHEDULE, server time). */
export function startBackupScheduler(): void {
  if (globalForScheduler.backupSchedulerStarted) return;
  if (process.env.DISABLE_BACKUP === "true") {
    log.info("Backups disabled (DISABLE_BACKUP=true)");
    return;
  }
  const schedule = config.backup.cronSchedule;
  if (!cron.validate(schedule)) {
    log.error({ schedule }, "Invalid BACKUP_CRON_SCHEDULE — backup scheduler not started");
    return;
  }
  cron.schedule(schedule, async () => {
    const { default: prisma } = await import("@/lib/prisma");
    try {
      await runBackup(prisma);
    } catch (err) {
      log.error({ err }, "Nightly backup failed");
    }
  });
  globalForScheduler.backupSchedulerStarted = true;
  log.info({ schedule, maxKeepDays: config.backup.maxKeepDays }, "Backup scheduler started");
}
