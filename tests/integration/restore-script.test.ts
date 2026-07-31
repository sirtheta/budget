import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "child_process";
import { mkdtempSync, existsSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import Database from "better-sqlite3";

vi.mock("@/lib/prisma", () => ({ default: {}, getDbPath: () => "/unused" }));

import { runBackup } from "@/lib/backup";
import { createTestDb } from "./helpers";

const SCRIPT = join(process.cwd(), "scripts", "restore.js");

/**
 * Runs scripts/restore.js the way the operator does — as a separate process
 * with DATABASE_URL pointing at the database to replace. Testing it any other
 * way would test a reimplementation, and this script only ever runs on the
 * worst day of the installation's life.
 */
function restore(source: string, dbPath: string): { status: number; output: string } {
  try {
    const output = execFileSync("node", [SCRIPT, source], {
      env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, output };
  } catch (err) {
    const e = err as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("scripts/restore.js", () => {
  it("restores a backup and moves the replaced database aside", async () => {
    const db = createTestDb();
    dir = mkdtempSync(join(tmpdir(), "budget-restore-"));
    try {
      await db.prisma.account.create({
        data: { name: "Privatkonto", type: "Checking", openingBalanceCents: 1000 },
      });
      const backup = await runBackup(db.prisma, { backupDir: dir, maxKeepDays: 0 });

      // A "live" database that differs from the backup, so a successful
      // restore is observable rather than a no-op.
      const live = join(dir, "budget.db");
      const raw = new Database(live);
      raw.exec("CREATE TABLE Wrong (id INTEGER PRIMARY KEY)");
      raw.close();

      const { status, output } = restore(backup, live);

      expect(status).toBe(0);
      expect(output).toContain("Wiederhergestellt");

      const restored = new Database(live, { readonly: true });
      const accounts = restored.prepare('SELECT name FROM "Account"').all() as { name: string }[];
      restored.close();
      expect(accounts).toEqual([{ name: "Privatkonto" }]);

      // The replaced database is kept — restoring the wrong snapshot at 2am is
      // a realistic mistake and must not be an unrecoverable one.
      const asideFiles = readdirSync(dir).filter((f) => f.includes("pre-restore"));
      expect(asideFiles).toHaveLength(1);
    } finally {
      await db.cleanup();
    }
  });

  it("reports the backup contents before restoring", async () => {
    const db = createTestDb();
    dir = mkdtempSync(join(tmpdir(), "budget-restore-"));
    try {
      const account = await db.prisma.account.create({
        data: { name: "Privatkonto", type: "Checking", openingBalanceCents: 0 },
      });
      await db.prisma.transaction.create({
        data: {
          date: "2026-07-15",
          amountCents: -2500,
          accountId: account.id,
          description: "Migros",
        },
      });
      const backup = await runBackup(db.prisma, { backupDir: dir, maxKeepDays: 0 });

      const { output } = restore(backup, join(dir, "budget.db"));

      // Knowing what is in the file before committing to it is the difference
      // between a restore and a guess.
      expect(output).toContain("1 Buchungen");
      expect(output).toContain("2026-07-15");
    } finally {
      await db.cleanup();
    }
  });

  it("refuses a corrupt backup and leaves the live database untouched", () => {
    dir = mkdtempSync(join(tmpdir(), "budget-restore-"));
    const live = join(dir, "budget.db");
    const raw = new Database(live);
    raw.exec("CREATE TABLE Keep (id INTEGER PRIMARY KEY)");
    raw.close();

    const junk = join(dir, "budget-backup-2026-07-29.db");
    writeFileSync(junk, "not a database");

    const { status, output } = restore(junk, live);

    expect(status).toBe(1);
    expect(output).toContain("nichts verändert");

    const survivor = new Database(live, { readonly: true });
    const tables = survivor
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    survivor.close();
    expect(tables.map((t) => t.name)).toContain("Keep");
    expect(readdirSync(dir).filter((f) => f.includes("pre-restore"))).toHaveLength(0);
  });

  it("refuses a backup that does not exist", () => {
    dir = mkdtempSync(join(tmpdir(), "budget-restore-"));

    const { status, output } = restore(join(dir, "missing.db"), join(dir, "budget.db"));

    expect(status).toBe(1);
    expect(output).toContain("nicht gefunden");
  });

  it("removes WAL sidecars belonging to the replaced database", async () => {
    const db = createTestDb();
    dir = mkdtempSync(join(tmpdir(), "budget-restore-"));
    try {
      const backup = await runBackup(db.prisma, { backupDir: dir, maxKeepDays: 0 });
      const live = join(dir, "budget.db");
      new Database(live).close();
      // Left in place, SQLite would replay these on top of the restored file.
      writeFileSync(`${live}-wal`, "stale");
      writeFileSync(`${live}-shm`, "stale");

      expect(restore(backup, live).status).toBe(0);

      expect(existsSync(`${live}-wal`)).toBe(false);
      expect(existsSync(`${live}-shm`)).toBe(false);
    } finally {
      await db.cleanup();
    }
  });
});
