import { mkdtempSync, readFileSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import Database from "better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

/**
 * A throwaway SQLite database per test file, built by replaying the committed
 * migration SQL.
 *
 * Replaying the real migrations rather than `prisma db push` keeps the test
 * schema identical to production — including the unique index on
 * `Transaction.importHash`, which several tests depend on.
 */
export interface TestDb {
  prisma: PrismaClient;
  cleanup: () => Promise<void>;
}

export function createTestDb(): TestDb {
  const dir = mkdtempSync(join(tmpdir(), "budget-test-"));
  const dbPath = join(dir, "test.db");

  const raw = new Database(dbPath);
  const migrationsDir = join(process.cwd(), "prisma", "migrations");
  const folders = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const folder of folders) {
    raw.exec(readFileSync(join(migrationsDir, folder, "migration.sql"), "utf8"));
  }
  raw.close();

  const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: dbPath }) });

  return {
    prisma,
    cleanup: async () => {
      await prisma.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** A minimal but complete fixture: one account and an income/expense category. */
export async function seedBasics(prisma: PrismaClient) {
  const account = await prisma.account.create({
    data: { name: "Privatkonto", type: "Checking", openingBalanceCents: 100000 },
  });
  const savings = await prisma.account.create({
    data: { name: "Sparkonto", type: "Savings", openingBalanceCents: 500000 },
  });
  const income = await prisma.category.create({ data: { name: "Lohn", kind: "Income" } });
  const groceries = await prisma.category.create({
    data: { name: "Lebensmittel", kind: "Expense" },
  });
  return { account, savings, income, groceries };
}
