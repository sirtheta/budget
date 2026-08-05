import { mkdirSync, readFileSync, readdirSync, rmSync } from "fs";
import path from "path";
import Database from "better-sqlite3";
import { hashSync } from "bcryptjs";

export const E2E_ADMIN = { email: "admin@e2e.local", password: "e2e-password-123" };
export const E2E_VIEWER = { email: "viewer@e2e.local", password: "e2e-password-123" };

/**
 * Creates a fresh SQLite database for the E2E run by replaying the committed
 * migrations, then seeds two users, an account and a category so the app has
 * something to render. The dev server started by Playwright's webServer points
 * at this file.
 */
export default function globalSetup(): void {
  const dataDir = path.join(__dirname, ".data");
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "e2e.db");

  const db = new Database(dbPath);

  const migrationsDir = path.join(__dirname, "..", "..", "prisma", "migrations");
  const folders = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const folder of folders) {
    db.exec(readFileSync(path.join(migrationsDir, folder, "migration.sql"), "utf8"));
  }

  const now = new Date().toISOString();
  const insertUser = db.prepare(
    `INSERT INTO User (email, name, passwordHash, role, isActive, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, 1, ?, ?)`
  );
  // Low bcrypt cost — these credentials only ever exist inside the test run.
  insertUser.run(E2E_ADMIN.email, "E2E Admin", hashSync(E2E_ADMIN.password, 4), "Admin", now, now);
  insertUser.run(
    E2E_VIEWER.email,
    "E2E Viewer",
    hashSync(E2E_VIEWER.password, 4),
    "Viewer",
    now,
    now
  );

  db.prepare(
    `INSERT INTO Account (name, type, openingBalanceCents, sortOrder, isActive, excludeFromBudget, createdAt, updatedAt)
     VALUES (?, 'Checking', 100000, 0, 1, 0, ?, ?)`
  ).run("Privatkonto", now, now);

  // Two categories, so the budget page renders more than one Soll input —
  // saving into a second field after a first save is its own failure mode.
  const insertCategory = db.prepare(
    `INSERT INTO Category (name, kind, sortOrder, isActive, createdAt, updatedAt)
     VALUES (?, 'Expense', ?, 1, ?, ?)`
  );
  insertCategory.run("Lebensmittel", 0, now, now);
  insertCategory.run("Wohnen", 1, now, now);

  db.prepare(`INSERT INTO SystemSettings (id, currency, updatedAt) VALUES (1, 'CHF', ?)`).run(now);

  db.close();
}
