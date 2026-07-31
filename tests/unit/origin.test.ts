import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const headersGet = vi.fn();
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({ get: headersGet })),
}));

import { appOrigin } from "@/lib/origin";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  headersGet.mockReset();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("appOrigin", () => {
  it("prefers the configured AUTH_URL, stripped of a trailing slash", async () => {
    process.env.AUTH_URL = "https://budget.example.ch/";
    expect(await appOrigin()).toBe("https://budget.example.ch");
    expect(headersGet).not.toHaveBeenCalled();
  });

  it("falls back to the Host header with https in production", async () => {
    delete process.env.AUTH_URL;
    vi.stubEnv("NODE_ENV", "production");
    headersGet.mockReturnValue("budget.example.ch");
    expect(await appOrigin()).toBe("https://budget.example.ch");
  });

  it("falls back to the Host header with http outside production", async () => {
    delete process.env.AUTH_URL;
    vi.stubEnv("NODE_ENV", "development");
    headersGet.mockReturnValue("localhost:3000");
    expect(await appOrigin()).toBe("http://localhost:3000");
  });
});
