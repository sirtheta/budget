import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import Database from "better-sqlite3";

// runBackup/pruneOldBackups never touch the default prisma singleton (a
// backupDir is always passed explicitly below), but the module still
// unconditionally calls getDbPath() to compute its fallback — override the
// global "@/lib/prisma" mock (tests/setup.ts) so that named export exists too.
vi.mock("@/lib/prisma", () => ({ default: {}, getDbPath: () => "/unused" }));

import { runBackup, pruneOldBackups, verifyBackup } from "@/lib/backup";
import { createTestDb } from "./helpers";

function tmpDir() {
  return mkdtempSync(join(tmpdir(), "budget-backup-"));
}

describe("runBackup", () => {
  it("writes a VACUUM INTO snapshot named for today and prunes old backups", async () => {
    const db = createTestDb();
    const backupDir = tmpDir();
    try {
      writeFileSync(join(backupDir, "budget-backup-2020-01-01.db"), "");
      const now = new Date("2026-07-29T12:00:00Z");

      const target = await runBackup(db.prisma, { backupDir, maxKeepDays: 14, now });

      expect(target).toBe(join(backupDir, "budget-backup-2026-07-29.db"));
      expect(existsSync(target)).toBe(true);
      expect(existsSync(join(backupDir, "budget-backup-2020-01-01.db"))).toBe(false);
    } finally {
      await db.cleanup();
      rmSync(backupDir, { recursive: true, force: true });
    }
  });

  it("overwrites a same-day backup on rerun instead of failing", async () => {
    const db = createTestDb();
    const backupDir = tmpDir();
    try {
      const now = new Date("2026-07-29T08:00:00Z");
      await db.prisma.account.create({
        data: { name: "Erstes Konto", type: "Checking", openingBalanceCents: 0 },
      });
      const first = await runBackup(db.prisma, { backupDir, maxKeepDays: 0, now });
      const firstSize = readFileSync(first).length;

      await db.prisma.account.create({
        data: { name: "Zweites Konto", type: "Checking", openingBalanceCents: 0 },
      });
      const second = await runBackup(db.prisma, { backupDir, maxKeepDays: 0, now });

      expect(second).toBe(first);
      expect(readFileSync(second).length).toBeGreaterThanOrEqual(firstSize);
    } finally {
      await db.cleanup();
      rmSync(backupDir, { recursive: true, force: true });
    }
  });
});

describe("verifyBackup", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("accepts a snapshot written by runBackup", async () => {
    const db = createTestDb();
    dir = tmpDir();
    try {
      const target = await runBackup(db.prisma, { backupDir: dir, maxKeepDays: 0 });
      expect(verifyBackup(target)).toEqual({ ok: true });
    } finally {
      await db.cleanup();
    }
  });

  it("rejects a file that does not exist", () => {
    dir = tmpDir();
    const result = verifyBackup(join(dir, "nope.db"));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("existiert nicht");
  });

  it("rejects a zero-byte file", () => {
    // What a backup interrupted by a full disk leaves behind, and the case the
    // directory listing makes look like a successful backup.
    dir = tmpDir();
    const empty = join(dir, "budget-backup-2026-07-29.db");
    writeFileSync(empty, "");

    expect(verifyBackup(empty).ok).toBe(false);
  });

  it("rejects a file that is not SQLite at all", () => {
    dir = tmpDir();
    const junk = join(dir, "budget-backup-2026-07-29.db");
    writeFileSync(junk, "this is not a database");

    expect(verifyBackup(junk).ok).toBe(false);
  });

  it("rejects a SQLite file without the app's schema", () => {
    dir = tmpDir();
    const other = join(dir, "other.db");
    const raw = new Database(other);
    raw.exec("CREATE TABLE Something (id INTEGER PRIMARY KEY)");
    raw.close();

    const result = verifyBackup(other);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Tabellen fehlen");
  });
});

describe("runBackup verification", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("discards an unusable snapshot and keeps older backups", async () => {
    const db = createTestDb();
    dir = tmpDir();
    try {
      const older = join(dir, "budget-backup-2020-01-01.db");
      writeFileSync(older, "");

      // Force a snapshot that passes VACUUM INTO but fails verification, by
      // having the "database" produce a file with none of the app's tables.
      const bare = createTestDb();
      await bare.prisma.$executeRawUnsafe("DROP TABLE User");
      const now = new Date("2026-07-29T12:00:00Z");

      await expect(
        runBackup(bare.prisma, { backupDir: dir, maxKeepDays: 14, now })
      ).rejects.toThrow(/verification failed/i);

      // The broken snapshot is gone …
      expect(existsSync(join(dir, "budget-backup-2026-07-29.db"))).toBe(false);
      // … and pruning never ran, so the old backup survived. A run that
      // produced nothing usable must not delete the last good one.
      expect(existsSync(older)).toBe(true);

      await bare.cleanup();
    } finally {
      await db.cleanup();
    }
  });
});

describe("pruneOldBackups", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("deletes only files older than the retention window", () => {
    dir = tmpDir();
    writeFileSync(join(dir, "budget-backup-2026-07-01.db"), "");
    writeFileSync(join(dir, "budget-backup-2026-07-28.db"), "");
    writeFileSync(join(dir, "not-a-backup.txt"), "");
    const now = new Date("2026-07-29T00:00:00Z");

    const deleted = pruneOldBackups(dir, 14, now);

    expect(deleted).toBe(1);
    expect(existsSync(join(dir, "budget-backup-2026-07-01.db"))).toBe(false);
    expect(existsSync(join(dir, "budget-backup-2026-07-28.db"))).toBe(true);
    expect(existsSync(join(dir, "not-a-backup.txt"))).toBe(true);
  });

  it("keeps everything when maxKeepDays is 0", () => {
    dir = tmpDir();
    writeFileSync(join(dir, "budget-backup-2000-01-01.db"), "");
    expect(pruneOldBackups(dir, 0)).toBe(0);
    expect(existsSync(join(dir, "budget-backup-2000-01-01.db"))).toBe(true);
  });
});
