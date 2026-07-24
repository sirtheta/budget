/** Parse an integer env value; falls back when unset/malformed (0 is a valid value). */
function envInt(value: string | undefined, fallback: number): number {
  const parsed = parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  session: {
    maxAgeSec: parseInt(process.env.SESSION_MAX_AGE_SEC ?? "") || 7 * 24 * 60 * 60,
    updateAgeSec: parseInt(process.env.SESSION_UPDATE_AGE_SEC ?? "") || 24 * 60 * 60,
  },
  rateLimit: {
    maxAttempts: parseInt(process.env.RATE_LIMIT_MAX_ATTEMPTS ?? "") || 5,
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? "") || 15 * 60 * 1000,
  },
  bcrypt: {
    rounds: parseInt(process.env.BCRYPT_ROUNDS ?? "") || 10,
  },
  recurring: {
    // Posts due standing entries. Hourly rather than daily so a container that
    // is switched off overnight still catches up the same day it comes back.
    cronSchedule: process.env.RECURRING_CRON_SCHEDULE || "5 * * * *",
    // IANA timezone that decides which calendar day "due" refers to,
    // independent of the server's own TZ.
    timezone: process.env.APP_TIMEZONE || "Europe/Zurich",
  },
  audit: {
    // Days to keep AuditLog rows; 0 disables pruning (keep forever).
    retentionDays: envInt(process.env.AUDIT_RETENTION_DAYS, 365),
  },
  backup: {
    // Nightly SQLite backup (VACUUM INTO <data>/backups). Runs in server time.
    cronSchedule: process.env.BACKUP_CRON_SCHEDULE || "30 2 * * *",
    // Days to keep backup files; 0 disables pruning (keep all).
    maxKeepDays: envInt(process.env.BACKUP_MAX_KEEP_DAYS, 14),
  },
  import: {
    // Upload guard for CAMT.053/CSV files, in bytes.
    maxFileSizeBytes: envInt(process.env.IMPORT_MAX_FILE_SIZE_BYTES, 10 * 1024 * 1024),
  },
} as const;
