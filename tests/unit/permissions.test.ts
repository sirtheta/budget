import { describe, expect, it, vi, beforeEach } from "vitest";
import { UserRole } from "@prisma/client";
import type { Session } from "next-auth";

const { authMock, redirectMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import { hasRole, requireRole, requireAdmin, requireEditor, requireSession } from "@/lib/permissions";

function session(role: UserRole): Session {
  return { user: { id: "1", role, name: "Test", email: "t@x.ch" }, expires: "" } as Session;
}

beforeEach(() => {
  authMock.mockReset();
  redirectMock.mockClear();
});

describe("hasRole", () => {
  it("is true when the session's role is in the allowed list", () => {
    expect(hasRole(session(UserRole.Admin), [UserRole.Admin, UserRole.Editor])).toBe(true);
  });

  it("is false when the session's role is not allowed", () => {
    expect(hasRole(session(UserRole.Viewer), [UserRole.Admin])).toBe(false);
  });
});

describe("requireRole", () => {
  it("returns the session when the role is allowed", async () => {
    authMock.mockResolvedValue(session(UserRole.Editor));
    await expect(requireRole([UserRole.Editor])).resolves.toMatchObject({
      user: { role: UserRole.Editor },
    });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("redirects to /login when there is no session", async () => {
    authMock.mockResolvedValue(null);
    await expect(requireRole([UserRole.Admin])).rejects.toThrow("REDIRECT:/login");
  });

  it("redirects to /dashboard when the role is not allowed", async () => {
    authMock.mockResolvedValue(session(UserRole.Viewer));
    await expect(requireRole([UserRole.Admin])).rejects.toThrow("REDIRECT:/dashboard");
  });
});

describe("requireAdmin / requireEditor / requireSession", () => {
  it("requireAdmin accepts only Admin", async () => {
    authMock.mockResolvedValue(session(UserRole.Admin));
    await expect(requireAdmin()).resolves.toBeTruthy();

    authMock.mockResolvedValue(session(UserRole.Editor));
    await expect(requireAdmin()).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("requireEditor accepts Admin and Editor but not Viewer", async () => {
    authMock.mockResolvedValue(session(UserRole.Editor));
    await expect(requireEditor()).resolves.toBeTruthy();

    authMock.mockResolvedValue(session(UserRole.Viewer));
    await expect(requireEditor()).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("requireSession accepts any known role", async () => {
    authMock.mockResolvedValue(session(UserRole.Viewer));
    await expect(requireSession()).resolves.toBeTruthy();
  });
});
