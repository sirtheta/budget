import { describe, expect, it, vi, beforeEach } from "vitest";

const { signInMock } = vi.hoisted(() => ({ signInMock: vi.fn() }));

vi.mock("@/lib/auth", () => ({ signIn: signInMock }));

// Real "next-auth" (unmocked) fails to resolve under Vitest's node
// environment here (next-auth's index imports "next/server", which this
// Next version's package.json doesn't expose via a resolvable subpath
// outside the Next build pipeline) — stand in with faithful equivalents of
// just the two error classes loginAction.ts actually uses.
vi.mock("next-auth", () => {
  class AuthError extends Error {}
  class CredentialsSignin extends AuthError {
    code = "credentials";
  }
  return { AuthError, CredentialsSignin };
});

import { AuthError, CredentialsSignin } from "next-auth";
import { loginAction } from "@/app/(auth)/login/actions";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

beforeEach(() => {
  signInMock.mockReset();
});

describe("loginAction", () => {
  it("returns no error on success", async () => {
    signInMock.mockResolvedValue(undefined);
    const result = await loginAction(undefined, form({ email: "a@b.ch", password: "pw" }));
    expect(result).toEqual({});
  });

  it("asks for a 2FA code when the account requires one", async () => {
    signInMock.mockRejectedValue(Object.assign(new CredentialsSignin(), { code: "two-factor-required" }));
    const result = await loginAction(undefined, form({ email: "a@b.ch", password: "pw" }));
    expect(result).toEqual({ needsTwoFactor: true });
  });

  it("reports an invalid 2FA code while staying on the code step", async () => {
    signInMock.mockRejectedValue(
      Object.assign(new CredentialsSignin(), { code: "invalid-two-factor-code" })
    );
    const result = await loginAction(undefined, form({ email: "a@b.ch", password: "pw", code: "000000" }));
    expect(result).toEqual({ needsTwoFactor: true, error: "Code ist ungültig oder abgelaufen." });
  });

  it("shows a generic error for wrong credentials", async () => {
    signInMock.mockRejectedValue(new CredentialsSignin());
    const result = await loginAction(undefined, form({ email: "a@b.ch", password: "wrong" }));
    expect(result).toEqual({ error: "E-Mail oder Passwort ist falsch." });
  });

  it("shows a generic error for any other AuthError", async () => {
    signInMock.mockRejectedValue(new AuthError("boom"));
    const result = await loginAction(undefined, form({ email: "a@b.ch", password: "pw" }));
    expect(result).toEqual({ error: "E-Mail oder Passwort ist falsch." });
  });

  it("rethrows Next.js's internal redirect signal instead of swallowing it", async () => {
    const redirectErr = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;push;/dashboard;",
    });
    signInMock.mockRejectedValue(redirectErr);
    await expect(loginAction(undefined, form({ email: "a@b.ch", password: "pw" }))).rejects.toBe(
      redirectErr
    );
  });

  it("rethrows an unexpected error", async () => {
    const boom = new Error("db exploded");
    signInMock.mockRejectedValue(boom);
    await expect(loginAction(undefined, form({ email: "a@b.ch", password: "pw" }))).rejects.toBe(boom);
  });
});
