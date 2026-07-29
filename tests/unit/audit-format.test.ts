import { describe, expect, it } from "vitest";
import type { AuditLog } from "@prisma/client";
import { actionLabel, entityLabel, describeAuditLog } from "@/lib/audit-format";

function log(overrides: Partial<AuditLog> = {}): AuditLog {
  return {
    id: 1,
    userId: 1,
    userName: "Admin",
    action: "CREATE",
    entityType: "Transaction",
    entityId: 1,
    details: null,
    createdAt: new Date("2026-01-01"),
    ...overrides,
  } as AuditLog;
}

describe("actionLabel / entityLabel", () => {
  it("translates known actions and entities to German", () => {
    expect(actionLabel("CREATE")).toBe("Erstellt");
    expect(actionLabel("IMPORT")).toBe("Importiert");
    expect(entityLabel("Transaction")).toBe("Buchung");
    expect(entityLabel("User")).toBe("Benutzer");
  });

  it("falls back to the raw value for unknown codes", () => {
    expect(actionLabel("FROBNICATE")).toBe("FROBNICATE");
    expect(entityLabel("Widget")).toBe("Widget");
  });
});

describe("describeAuditLog", () => {
  it("returns an em dash when there are no details", () => {
    expect(describeAuditLog(log({ details: null }))).toBe("—");
  });

  it("returns the raw string when details isn't valid JSON", () => {
    expect(describeAuditLog(log({ details: "not json" }))).toBe("not json");
  });

  it("describes a transaction with date, description and amount", () => {
    const details = JSON.stringify({
      date: "2026-02-05",
      description: "Migros",
      amountCents: -8240,
    });
    expect(describeAuditLog(log({ entityType: "Transaction", details }))).toBe(
      "05.02.2026, Migros, −CHF 82.40"
    );
  });

  it("prefixes a transfer transaction", () => {
    const details = JSON.stringify({ date: "2026-02-05", description: "Umbuchung", transfer: true });
    expect(describeAuditLog(log({ entityType: "Transaction", details }))).toBe(
      "Umbuchung: 05.02.2026, Umbuchung"
    );
  });

  it("describes an import with counts and filename", () => {
    const details = JSON.stringify({ imported: 12, skipped: 3, filename: "statement.csv" });
    expect(
      describeAuditLog(log({ entityType: "Transaction", action: "IMPORT", details }))
    ).toBe("12 importiert, 3 Duplikate übersprungen (statement.csv)");
  });

  it("describes a budget change", () => {
    const details = JSON.stringify({ categoryName: "Lebensmittel", year: 2026, month: 3, amountCents: 60000 });
    expect(describeAuditLog(log({ entityType: "Budget", details }))).toBe(
      "Lebensmittel, 3/2026, CHF 600.00"
    );
  });

  it("describes an account/category activation toggle", () => {
    const details = JSON.stringify({ name: "Sparkonto", isActive: false });
    expect(describeAuditLog(log({ entityType: "Account", details }))).toBe("Sparkonto — deaktiviert");
  });

  it("describes an account/category with only a name", () => {
    const details = JSON.stringify({ name: "Freizeit" });
    expect(describeAuditLog(log({ entityType: "Category", details }))).toBe("Freizeit");
  });

  it("describes user email, activation and role changes", () => {
    expect(
      describeAuditLog(log({ entityType: "User", details: JSON.stringify({ email: "a@b.ch" }) }))
    ).toBe("E-Mail: a@b.ch");
    expect(
      describeAuditLog(log({ entityType: "User", details: JSON.stringify({ isActive: true }) }))
    ).toBe("Aktiviert");
    expect(
      describeAuditLog(log({ entityType: "User", details: JSON.stringify({ isActive: false }) }))
    ).toBe("Deaktiviert");
    expect(
      describeAuditLog(log({ entityType: "User", details: JSON.stringify({ role: "Admin" }) }))
    ).toBe("Rolle: Admin");
  });

  it("falls back to raw JSON for an unrecognised entity type", () => {
    const details = JSON.stringify({ foo: "bar" });
    expect(describeAuditLog(log({ entityType: "Settings", details }))).toBe(details);
  });

  it("returns an em dash for an empty details object", () => {
    expect(describeAuditLog(log({ entityType: "Settings", details: "{}" }))).toBe("—");
  });
});
