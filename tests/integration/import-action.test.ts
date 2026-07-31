import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { withHashes } from "@/lib/import/dedupe";
import { createTestDb, seedBasics } from "./helpers";

const { prismaHolder, sessionHolder, revalidatePathMock } = vi.hoisted(() => ({
  prismaHolder: { current: undefined as unknown },
  sessionHolder: { current: { user: { id: "1", role: "Editor", name: "Editor", email: "e@test.ch" } } },
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  get default() {
    return prismaHolder.current;
  },
  getDbPath: () => "/unused",
}));
vi.mock("@/lib/permissions", () => ({
  requireEditor: vi.fn(async () => sessionHolder.current),
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import {
  previewImportAction,
  commitImportAction,
  deleteImportBatchAction,
  inspectCsvAction,
} from "@/app/(app)/import/actions";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
let fixtures: Awaited<ReturnType<typeof seedBasics>>;
let mappingId: number;

const CSV = "Datum;Beschreibung;Betrag\n2026-07-01;Migros;-42.50\n2026-07-02;Lohn;5000.00\n";

function csvForm(fields: Record<string, string> = {}, text = CSV) {
  const data = new FormData();
  data.append("file", new File([text], "statement.csv", { type: "text/csv" }));
  data.append("format", "Csv");
  data.append("mappingId", String(mappingId));
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

beforeAll(async () => {
  const db = createTestDb();
  prisma = db.prisma;
  cleanup = db.cleanup;
  prismaHolder.current = prisma;
  fixtures = await seedBasics(prisma);
  const editor = await prisma.user.create({
    data: { email: "e@test.ch", name: "Editor", passwordHash: "x", role: "Editor" },
  });
  sessionHolder.current = {
    user: { id: String(editor.id), role: "Editor", name: "Editor", email: "e@test.ch" },
  };
  const mapping = await prisma.csvMapping.create({
    data: {
      name: "Testbank",
      delimiter: ";",
      dateColumn: 0,
      dateFormat: "YYYY-MM-DD",
      descriptionColumn: 1,
      amountColumn: 2,
      decimalSeparator: ".",
      thousandsSeparator: "'",
    },
  });
  mappingId = mapping.id;
});

afterAll(async () => cleanup());

afterEach(() => {
  revalidatePathMock.mockClear();
});

describe("previewImportAction", () => {
  it("rejects an empty upload", async () => {
    const data = new FormData();
    data.append("format", "Csv");
    const result = await previewImportAction(undefined, data);
    expect(result.error).toBeTruthy();
  });

  it("requires a mapping for CSV uploads", async () => {
    const data = csvForm({ accountId: String(fixtures.account.id) });
    data.delete("mappingId");
    const result = await previewImportAction(undefined, data);
    expect(result.error).toBe("Bitte ein CSV-Mapping auswählen.");
  });

  it("rejects an unknown mapping id", async () => {
    const data = csvForm({ accountId: String(fixtures.account.id) });
    data.set("mappingId", "999999");
    const result = await previewImportAction(undefined, data);
    expect(result.error).toBe("CSV-Mapping nicht gefunden.");
  });

  it("requires a target account when the statement has no IBAN", async () => {
    const data = csvForm();
    const result = await previewImportAction(undefined, data);
    expect(result.error).toBe("Bitte das Zielkonto auswählen.");
  });

  it("rejects an unknown explicit account id", async () => {
    const data = csvForm({ accountId: "999999" });
    const result = await previewImportAction(undefined, data);
    expect(result.error).toBe("Konto nicht gefunden.");
  });

  it("returns a preview with parsed rows for a fresh import", async () => {
    const data = csvForm({ accountId: String(fixtures.account.id) });
    const result = await previewImportAction(undefined, data);
    expect(result.error).toBeUndefined();
    expect(result.preview?.rows).toHaveLength(2);
    expect(result.preview?.duplicateCount).toBe(0);
    expect(result.preview?.rows.map((r) => r.description).sort()).toEqual(["Lohn", "Migros"]);
  });

  it("flags a row as a duplicate once its hash already exists", async () => {
    const [hashed] = withHashes(fixtures.account.id, [
      { date: "2026-07-01", amountCents: -4250, description: "Migros", counterparty: null, bankReference: null },
    ]);
    await prisma.transaction.create({
      data: {
        date: "2026-07-01",
        amountCents: -4250,
        accountId: fixtures.account.id,
        description: "Migros",
        importHash: hashed.hash,
      },
    });

    const data = csvForm({ accountId: String(fixtures.account.id) });
    const result = await previewImportAction(undefined, data);
    expect(result.preview?.duplicateCount).toBe(1);

    // Clean up so later tests see a fresh account.
    await prisma.transaction.deleteMany({ where: { importHash: hashed.hash } });
  });

  it("does not count a row adopting a pending transfer leg twice in the balance check", async () => {
    // Simulates a recurring auto-transfer that already posted its synthetic,
    // not-yet-confirmed leg on this account (see applyAutoTransfer).
    const pending = await prisma.transaction.create({
      data: {
        date: "2026-08-01",
        amountCents: -5000,
        accountId: fixtures.account.id,
        description: "Umbuchung",
        transferGroupId: "pending-transfer-test",
      },
    });

    const xml = `<Document><BkToCstmrStmt><Stmt>
      <FrToDt><FrDtTm>2026-08-01T00:00:00</FrDtTm><ToDtTm>2026-08-02T23:59:59</ToDtTm></FrToDt>
      <Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="CHF">1000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>
      <Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="CHF">950.00</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>
      <Ntry>
        <Amt Ccy="CHF">50.00</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-08-02</Dt></BookgDt>
        <NtryDtls><TxDtls><Refs><AcctSvcrRef>REF-ADOPT-1</AcctSvcrRef></Refs></TxDtls></NtryDtls>
      </Ntry>
    </Stmt></BkToCstmrStmt></Document>`;

    const data = new FormData();
    data.append("file", new File([xml], "statement.xml", { type: "application/xml" }));
    data.append("format", "Camt053");
    data.append("accountId", String(fixtures.account.id));

    const result = await previewImportAction(undefined, data);
    expect(result.error).toBeUndefined();
    // The fresh row will adopt `pending` at commit time (same amount, date
    // within tolerance) instead of creating a second row, so the projected
    // balance must count that -50.00 movement only once.
    expect(result.preview?.balanceDeltaCents).toBe(0);

    await prisma.transaction.delete({ where: { id: pending.id } });
  });
});

describe("commitImportAction", () => {
  function commitPayload(overrides: Partial<Parameters<typeof commitImportAction>[0]> = {}) {
    const rows = withHashes(fixtures.account.id, [
      { date: "2026-07-01", amountCents: -4250, description: "Migros", counterparty: null, bankReference: null },
      { date: "2026-07-02", amountCents: 500000, description: "Lohn", counterparty: null, bankReference: null },
    ]).map((row) => ({ ...row, categoryId: null, transferAccountId: null }));

    return {
      accountId: fixtures.account.id,
      filename: "statement.csv",
      format: "Csv" as const,
      periodFrom: "2026-07-01",
      periodTo: "2026-07-02",
      closingBalanceCents: null,
      rows,
      ...overrides,
    };
  }

  it("rejects a tampered row hash", async () => {
    const payload = commitPayload();
    payload.rows[0].amountCents = -999999;
    const result = await commitImportAction(payload);
    expect(result.error).toMatch(/verändert/);
  });

  it("rejects an empty row selection", async () => {
    const result = await commitImportAction(commitPayload({ rows: [] }));
    expect(result.error).toBe("Es wurden keine Buchungen zum Import ausgewählt.");
  });

  it("rejects an unknown account", async () => {
    const result = await commitImportAction(commitPayload({ accountId: 999999 }));
    expect(result.error).toBe("Konto nicht gefunden.");
  });

  it("commits fresh rows, creating transactions and an audit entry", async () => {
    const result = await commitImportAction(commitPayload());
    expect(result).toEqual({ success: true, imported: 2, skipped: 0 });
    expect(revalidatePathMock).toHaveBeenCalledWith("/import");

    const created = await prisma.transaction.findMany({ where: { source: "Import" } });
    expect(created).toHaveLength(2);

    const batch = await prisma.importBatch.findFirstOrThrow({ where: { filename: "statement.csv" } });
    expect(batch.importedCount).toBe(2);

    const audit = await prisma.auditLog.findFirst({ where: { action: "IMPORT" } });
    expect(audit).toBeTruthy();
  });

  it("skips rows that were already imported", async () => {
    const result = await commitImportAction(commitPayload());
    expect(result.error).toBe("Alle ausgewählten Buchungen sind bereits importiert.");
  });
});

describe("deleteImportBatchAction", () => {
  it("returns an error for an unknown batch", async () => {
    const result = await deleteImportBatchAction(999999);
    expect(result.error).toBe("Import nicht gefunden.");
  });

  it("deletes every transaction from the batch and the batch itself", async () => {
    const batch = await prisma.importBatch.findFirstOrThrow({ where: { filename: "statement.csv" } });
    const result = await deleteImportBatchAction(batch.id);
    expect(result.success).toBe(true);
    expect(result.deleted).toBe(2);

    await expect(prisma.importBatch.findUniqueOrThrow({ where: { id: batch.id } })).rejects.toBeTruthy();
    const remaining = await prisma.transaction.findMany({ where: { importBatchId: batch.id } });
    expect(remaining).toHaveLength(0);
  });
});

describe("inspectCsvAction", () => {
  it("rejects an empty upload", async () => {
    const data = new FormData();
    const result = await inspectCsvAction(data);
    expect(result.error).toBeTruthy();
  });

  it("returns the first rows of the file with a detected delimiter", async () => {
    const data = new FormData();
    data.append("file", new File([CSV], "statement.csv", { type: "text/csv" }));
    const result = await inspectCsvAction(data);
    expect(result.delimiter).toBe(";");
    expect(result.rows?.[0]).toEqual(["Datum", "Beschreibung", "Betrag"]);
  });
});
