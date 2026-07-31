import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { validateEnv } from "@/lib/env";

const ORIGINAL_ENV = { ...process.env };
const SECRET = "s".repeat(32);
const KEY = "k".repeat(32);

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("validateEnv", () => {
  it("does nothing outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(() => validateEnv()).not.toThrow();
  });

  it("passes in production with valid secrets", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.AUTH_SECRET = SECRET;
    process.env.ENCRYPTION_KEY = KEY;
    process.env.AUTH_URL = "https://budget.example.ch";
    expect(() => validateEnv()).not.toThrow();
  });

  it("throws when required variables are missing in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.AUTH_SECRET;
    delete process.env.ENCRYPTION_KEY;
    expect(() => validateEnv()).toThrow(/Missing required environment variables/);
  });

  it("throws when a secret is a known placeholder", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.AUTH_SECRET = "INSECURE-DEFAULT-please-change-me-now";
    process.env.ENCRYPTION_KEY = KEY;
    expect(() => validateEnv()).toThrow(/publicly known placeholder/);
  });

  it("throws when AUTH_SECRET is too short", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.AUTH_SECRET = "short";
    process.env.ENCRYPTION_KEY = KEY;
    expect(() => validateEnv()).toThrow(/AUTH_SECRET must be at least 32 characters/);
  });

  it("throws when ENCRYPTION_KEY is too short", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.AUTH_SECRET = SECRET;
    process.env.ENCRYPTION_KEY = "short";
    expect(() => validateEnv()).toThrow(/ENCRYPTION_KEY must be at least 32 characters/);
  });

  it("warns (but does not throw) when AUTH_URL isn't https in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.AUTH_SECRET = SECRET;
    process.env.ENCRYPTION_KEY = KEY;
    process.env.AUTH_URL = "http://localhost:3000";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => validateEnv()).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("will not be"));
    warn.mockRestore();
  });

  it("warns when AUTH_URL is unset in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.AUTH_SECRET = SECRET;
    process.env.ENCRYPTION_KEY = KEY;
    delete process.env.AUTH_URL;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    validateEnv();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("not set"));
    warn.mockRestore();
  });
});
