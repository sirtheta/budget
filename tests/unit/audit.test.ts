import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Session } from "next-auth";

const { auditLogCreate, mockConfig } = vi.hoisted(() => ({
  auditLogCreate: vi.fn(),
  mockConfig: { audit: { retentionDays: 365 } },
}));

vi.mock("@/lib/prisma", () => ({
  default: { auditLog: { create: auditLogCreate } },
}));
vi.mock("@/lib/config", () => ({ config: mockConfig }));

import { logAudit, pruneExpiredAuditLogs } from "@/lib/audit";

const session = { user: { id: "3", name: "Admin", email: "admin@test.ch" } } as unknown as Session;

beforeEach(() => {
  auditLogCreate.mockReset();
  mockConfig.audit.retentionDays = 365;
});

describe("logAudit", () => {
  it("writes a row with the acting user's id, parsed from the session's string id", async () => {
    auditLogCreate.mockResolvedValue({});
    await logAudit(session, "CREATE", "Transaction", 42, { amountCents: -100 });
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: {
        userId: 3,
        userName: "Admin",
        action: "CREATE",
        entityType: "Transaction",
        entityId: 42,
        details: JSON.stringify({ amountCents: -100 }),
      },
    });
  });

  it("omits entityId and details when not given", async () => {
    auditLogCreate.mockResolvedValue({});
    await logAudit(session, "SETTINGS", "Settings");
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ entityId: null, details: null }),
    });
  });

  it("falls back to the email when the user has no name", async () => {
    auditLogCreate.mockResolvedValue({});
    const noName = { user: { id: "3", name: null, email: "a@b.ch" } } as unknown as Session;
    await logAudit(noName, "UPDATE", "Account");
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userName: "a@b.ch" }) })
    );
  });

  it("swallows a write failure instead of throwing, so audit logging never blocks the real operation", async () => {
    auditLogCreate.mockRejectedValue(new Error("db down"));
    await expect(logAudit(session, "DELETE", "Category")).resolves.toBeUndefined();
  });
});

describe("pruneExpiredAuditLogs", () => {
  it("does nothing and skips the query when retention is disabled (0)", async () => {
    mockConfig.audit.retentionDays = 0;
    const deleteMany = vi.fn();
    const count = await pruneExpiredAuditLogs({ auditLog: { deleteMany } } as never);
    expect(count).toBe(0);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("deletes rows older than the retention window and returns the count", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 5 });
    const now = new Date("2026-07-29T00:00:00Z");
    const count = await pruneExpiredAuditLogs({ auditLog: { deleteMany } } as never, now);
    expect(count).toBe(5);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date(now.getTime() - 365 * 86_400_000) } },
    });
  });

  it("returns 0 without error when nothing was old enough to delete", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const count = await pruneExpiredAuditLogs({ auditLog: { deleteMany } } as never);
    expect(count).toBe(0);
  });
});
