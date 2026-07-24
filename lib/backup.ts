import cron from "node-cron";
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
 * Writes a consistent snapshot of the live database via `VACUUM INTO` (one
 * file per calendar day; a same-day rerun replaces it) and prunes backups
 * older than the retention window. Returns the path of the written backup.
 *
 * The backup directory lives inside the data volume by default, so an
 * external sync of that directory (e.g. to a NAS) picks the backups up.
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
