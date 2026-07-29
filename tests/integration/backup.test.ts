import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// runBackup/pruneOldBackups never touch the default prisma singleton (a
// backupDir is always passed explicitly below), but the module still
// unconditionally calls getDbPath() to compute its fallback — override the
// global "@/lib/prisma" mock (tests/setup.ts) so that named export exists too.
vi.mock("@/lib/prisma", () => ({ default: {}, getDbPath: () => "/unused" }));

import { runBackup, pruneOldBackups } from "@/lib/backup";
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
