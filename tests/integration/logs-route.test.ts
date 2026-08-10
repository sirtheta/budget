import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { LOG_DIR } from "@/lib/logs";

const { sessionHolder } = vi.hoisted(() => ({
  sessionHolder: { current: null as unknown },
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessionHolder.current) }));

import { GET } from "@/app/api/logs/[filename]/route";

function req(filename: string) {
  return new NextRequest(`http://localhost/api/logs/${filename}`);
}

function ctx(filename: string) {
  return { params: Promise.resolve({ filename }) };
}

const admin = { user: { id: "1", role: "Admin", name: "Admin", email: "a@test.ch" } };
const editor = { user: { id: "2", role: "Editor", name: "Editor", email: "e@test.ch" } };

beforeAll(() => {
  mkdirSync(LOG_DIR, { recursive: true });
  writeFileSync(`${LOG_DIR}/app.log`, "current log line\n");
  writeFileSync(`${LOG_DIR}/app-2026-07-28.log`, "rotated log line\n");
});

afterAll(() => rmSync(LOG_DIR, { recursive: true, force: true }));

describe("GET /api/logs/[filename]", () => {
  it("rejects an unauthenticated request", async () => {
    sessionHolder.current = null;
    const res = await GET(req("app.log"), ctx("app.log"));
    expect(res.status).toBe(401);
  });

  it("rejects a non-admin", async () => {
    sessionHolder.current = editor;
    const res = await GET(req("app.log"), ctx("app.log"));
    expect(res.status).toBe(403);
  });

  it("streams the current log file for an admin", async () => {
    sessionHolder.current = admin;
    const res = await GET(req("app.log"), ctx("app.log"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("app.log");
    expect(await res.text()).toBe("current log line\n");
  });

  it("streams a rotated log file for an admin", async () => {
    sessionHolder.current = admin;
    const res = await GET(req("app-2026-07-28.log"), ctx("app-2026-07-28.log"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("rotated log line\n");
  });

  it("rejects a filename outside the exact log-file shape", async () => {
    sessionHolder.current = admin;
    const res = await GET(req("..%2F..%2F.env"), ctx("../../.env"));
    expect(res.status).toBe(404);
  });

  it("404s for a rotated-looking filename that does not exist", async () => {
    sessionHolder.current = admin;
    const res = await GET(req("app-2000-01-01.log"), ctx("app-2000-01-01.log"));
    expect(res.status).toBe(404);
  });
});
