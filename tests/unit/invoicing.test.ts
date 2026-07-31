import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/config", () => ({
  config: { customerManagement: { url: "https://crm.example.ch", apiKey: "secret" } },
}));

import { matchInvoicePayment } from "@/lib/invoicing";
import { logAudit } from "@/lib/audit";
import { config } from "@/lib/config";

const session = { user: { id: "1", name: "Admin", email: "admin@test.ch" } } as never;

// The real config is `as const` (readonly) so app code can't mutate it by
// accident; this test needs to flip it between cases, so it goes through a
// mutable view rather than loosening the production type.
const customerManagementConfig = config.customerManagement as { url: string | null; apiKey: string | null };

const params = {
  transactionId: 42,
  description: "Zahlung Rechnung R-26070042",
  amountCents: 12345,
  bookingDate: "2026-07-20",
};

describe("matchInvoicePayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    customerManagementConfig.url = "https://crm.example.ch";
  });

  it("does nothing when CustomerManagement isn't configured", async () => {
    customerManagementConfig.url = null;
    const fetchSpy = vi.spyOn(global, "fetch");

    await matchInvoicePayment(session, params);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("logs an audit entry when CustomerManagement reports a match", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ matched: true, documentNumber: "R-26070042" }),
      })
    );

    await matchInvoicePayment(session, params);

    expect(fetch).toHaveBeenCalledWith(
      "https://crm.example.ch/api/external/payments",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-api-key": "secret" }),
      })
    );
    expect(logAudit).toHaveBeenCalledWith(
      session,
      "UPDATE",
      "Transaction",
      42,
      expect.objectContaining({ note: expect.stringContaining("R-26070042") })
    );
  });

  it("does not log audit when nothing matched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ matched: false }),
      })
    );

    await matchInvoicePayment(session, params);

    expect(logAudit).not.toHaveBeenCalled();
  });

  it("never throws when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await expect(matchInvoicePayment(session, params)).resolves.toBeUndefined();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("never throws on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    await expect(matchInvoicePayment(session, params)).resolves.toBeUndefined();
    expect(logAudit).not.toHaveBeenCalled();
  });
});
