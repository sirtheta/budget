import { vi } from "vitest";

// Isolate the global prisma singleton between unit tests that mock it.
// Integration tests override this per-file with a temp SQLite database.
// Lazily constructed: modules that merely reference this as an unused
// default-parameter value (e.g. `prisma = defaultPrisma`) must not pay for
// (or crash on) a real client with no datasource adapter configured.
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  let client: InstanceType<typeof PrismaClient> | undefined;
  return {
    get default() {
      if (!client) client = new PrismaClient();
      return client;
    },
  };
});
