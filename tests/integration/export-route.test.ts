import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { PrismaClient } from "@prisma/client";
import { createTestDb, seedBasics } from "./helpers";

const { prismaHolder, sessionHolder } = vi.hoisted(() => ({
  prismaHolder: { current: undefined as unknown },
  sessionHolder: { current: null as unknown },
}));

vi.mock("@/lib/prisma", () => ({
  get default() {
    return prismaHolder.current;
  },
  getDbPath: () => "/unused",
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessionHolder.current) }));

import { GET } from "@/app/api/transactions/export/route";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
let fixtures: Awaited<ReturnType<typeof seedBasics>>;

function req(query = "") {
  return new NextRequest(`http://localhost/api/transactions/export${query}`);
}

beforeAll(async () => {
  const db = createTestDb();
  prisma = db.prisma;
  cleanup = db.cleanup;
  prismaHolder.current = prisma;
  fixtures = await seedBasics(prisma);
  sessionHolder.current = { user: { id: "1", role: "Editor", name: "Editor", email: "e@test.ch" } };

  await prisma.transaction.createMany({
    data: [
      {
        date: "2026-07-01",
        amountCents: -4250,
        accountId: fixtures.account.id,
        categoryId: fixtures.groceries.id,
        description: "Migros",
        counterparty: "Migros Zürich",
      },
      {
        date: "2026-07-05",
        amountCents: 500000,
        accountId: fixtures.account.id,
        categoryId: fixtures.income.id,
        description: "Lohn",
      },
      {
        date: "2026-07-10",
        amountCents: -1000,
        accountId: fixtures.account.id,
        description: "Unkategorisiert",
      },
    ],
  });
});

afterAll(async () => cleanup());

describe("GET /api/transactions/export", () => {
  it("rejects an unauthenticated request", async () => {
    sessionHolder.current = null;
    const res = await GET(req());
    expect(res.status).toBe(401);
    sessionHolder.current = { user: { id: "1", role: "Editor", name: "Editor", email: "e@test.ch" } };
  });

  it("returns a CSV with a header row and every transaction when unfiltered", async () => {
    const res = await GET(req());
    expect(res.headers.get("Content-Type")).toMatch(/text\/csv/);
    expect(res.headers.get("Content-Disposition")).toContain("buchungen-");
    const text = await res.text();
    const lines = text.trim().split("\n");
    expect(lines[0]).toContain("Datum");
    expect(lines).toHaveLength(4); // header + 3 transactions
  });

  it("filters by date range", async () => {
    const res = await GET(req("?from=2026-07-05&to=2026-07-05"));
    const lines = (await res.text()).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("Lohn");
  });

  it("filters uncategorised transactions with categoryId=none", async () => {
    const res = await GET(req("?categoryId=none"));
    const lines = (await res.text()).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("Unkategorisiert");
  });

  it("filters by type=income and type=expense", async () => {
    const income = (await (await GET(req("?type=income"))).text()).trim().split("\n");
    expect(income).toHaveLength(2);
    expect(income[1]).toContain("Lohn");

    const expense = (await (await GET(req("?type=expense"))).text()).trim().split("\n");
    expect(expense).toHaveLength(3);
  });

  it("filters by a free-text query against description/counterparty/notes", async () => {
    const res = await GET(req("?q=Zürich"));
    const lines = (await res.text()).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("Migros");
  });

  it("filters by account and category", async () => {
    const res = await GET(req(`?accountId=${fixtures.account.id}&categoryId=${fixtures.income.id}`));
    const lines = (await res.text()).trim().split("\n");
    expect(lines).toHaveLength(2);
  });
});
