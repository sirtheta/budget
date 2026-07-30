import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestDb } from "./helpers";

const { prismaHolder } = vi.hoisted(() => ({
  prismaHolder: { current: undefined as unknown },
}));

vi.mock("@/lib/prisma", () => ({
  get default() {
    return prismaHolder.current;
  },
  getDbPath: () => "/unused",
}));

import { GET } from "@/app/api/health/route";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const db = createTestDb();
  prisma = db.prisma;
  cleanup = db.cleanup;
  prismaHolder.current = prisma;
});

afterAll(async () => {
  await cleanup();
});

describe("GET /api/health", () => {
  it("reports ok when the database answers", async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("is never cached", async () => {
    const res = await GET();

    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("reports 503 when the database is unreachable", async () => {
    // The whole point of the endpoint: an unreachable database has to fail the
    // probe, which the previous /api/auth/session check could not detect.
    prismaHolder.current = {
      user: { count: () => Promise.reject(new Error("unable to open database file")) },
    };

    const res = await GET();

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "error" });

    prismaHolder.current = prisma;
  });

  it("does not leak failure details to an unauthenticated caller", async () => {
    prismaHolder.current = {
      user: { count: () => Promise.reject(new Error("/data/budget.db is corrupt")) },
    };

    const body = await (await GET()).text();

    expect(body).not.toContain("corrupt");
    expect(body).not.toContain("budget.db");

    prismaHolder.current = prisma;
  });

  it("fails while the schema is still missing", async () => {
    // Counting a table proves the migrations ran; `SELECT 1` would succeed
    // against an empty database file and advertise a half-started container.
    const empty = createTestDb();
    await empty.prisma.$executeRawUnsafe("DROP TABLE User");
    prismaHolder.current = empty.prisma;

    expect((await GET()).status).toBe(503);

    prismaHolder.current = prisma;
    await empty.cleanup();
  });
});
