/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

/**
 * Restores a backup written by lib/backup.ts.
 *
 *   docker compose exec budget node scripts/restore.js /app/data/backups/budget-backup-2026-07-29.db
 *
 * The app must be stopped or restarted around this — a running server holds
 * the old database open, and swapping the file underneath it leaves the
 * process serving a handle to a file that no longer exists at that path.
 *
 * Existed as an undocumented "copy the file back" step before, which is the
 * kind of procedure that is only ever discovered to be wrong while it is being
 * performed for real. This script verifies the backup before touching
 * anything, and moves the current database aside instead of overwriting it, so
 * restoring the wrong snapshot is not the end of the story.
 */

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const REQUIRED_TABLES = ['User', 'Account', 'Transaction', 'Category'];

function fail(message) {
  console.error(`[restore] ${message}`);
  process.exit(1);
}

/**
 * Mirrors verifyBackup() in lib/backup.ts. Duplicated rather than imported
 * because the production image ships no TypeScript runtime — startup.js takes
 * the same approach with the migrations.
 */
function verify(file) {
  let db;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    const integrity = db.pragma('quick_check', { simple: true });
    if (integrity !== 'ok') return `SQLite meldet: ${integrity}`;

    const present = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)
    );
    const missing = REQUIRED_TABLES.filter((table) => !present.has(table));
    if (missing.length > 0) return `Tabellen fehlen: ${missing.join(', ')}`;
    return null;
  } catch (err) {
    return err.message;
  } finally {
    db?.close();
  }
}

function summarise(file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n;
    const latest = db.prepare('SELECT MAX(date) AS d FROM "Transaction"').get().d;
    return {
      transactions: count('Transaction'),
      accounts: count('Account'),
      users: count('User'),
      latestTransaction: latest ?? '—',
    };
  } finally {
    db.close();
  }
}

const source = process.argv[2];
if (!source) {
  fail('Usage: node scripts/restore.js <backup-file>');
}
if (!fs.existsSync(source)) {
  fail(`Backup nicht gefunden: ${source}`);
}

const dbPath = (process.env.DATABASE_URL ?? 'file:/app/data/budget.db').replace(/^file:/, '');

const problem = verify(source);
if (problem) {
  fail(`Backup ist nicht wiederherstellbar (${problem}). Es wurde nichts verändert.`);
}

const stats = summarise(source);
console.log(`[restore] Backup geprüft: ${source}`);
console.log(
  `[restore]   ${stats.transactions} Buchungen, ${stats.accounts} Konten, ` +
    `${stats.users} Benutzer, letzte Buchung ${stats.latestTransaction}`
);

// Keep the database that is being replaced. Restoring the wrong snapshot is a
// realistic mistake at 2am, and without this it is an unrecoverable one.
if (fs.existsSync(dbPath)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const aside = `${dbPath}.pre-restore-${stamp}`;
  fs.renameSync(dbPath, aside);
  console.log(`[restore] Bisherige Datenbank gesichert nach ${aside}`);
}

// The rollback journal and WAL sidecars belong to the replaced database. Left
// in place, SQLite would apply them on top of the restored file and corrupt it.
for (const suffix of ['-wal', '-shm', '-journal']) {
  const sidecar = `${dbPath}${suffix}`;
  if (fs.existsSync(sidecar)) {
    fs.unlinkSync(sidecar);
    console.log(`[restore] Entfernt: ${path.basename(sidecar)}`);
  }
}

fs.copyFileSync(source, dbPath);
console.log(`[restore] Wiederhergestellt nach ${dbPath}`);
console.log('[restore] Container jetzt neu starten: docker compose restart');
