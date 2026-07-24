import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

export const DEFAULT_DB_URL = "file:./data/budget.db";

export function getDbPath() {
  return (process.env.DATABASE_URL ?? DEFAULT_DB_URL).replace(/^file:/, "");
}

function createPrismaClient() {
  const adapter = new PrismaBetterSqlite3({ url: getDbPath() });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
};

const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
