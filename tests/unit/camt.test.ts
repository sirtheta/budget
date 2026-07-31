import { describe, expect, it } from "vitest";
import { parseCamt053 } from "@/lib/import/camt";

/** Minimal but structurally faithful CAMT.053 document. */
function camt(entries: string, options: { namespace?: string } = {}): string {
  const ns = options.namespace ?? "";
  const open = ns ? `${ns}:` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<${open}Document xmlns${ns ? `:${ns}` : ""}="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
  <${open}BkToCstmrStmt>
    <${open}GrpHdr><${open}MsgId>TEST</${open}MsgId></${open}GrpHdr>
    <${open}Stmt>
      <${open}Id>ST-1</${open}Id>
      <${open}Acct>
        <${open}Id><${open}IBAN>CH9300762011623852957</${open}IBAN></${open}Id>
        <${open}Ccy>CHF</${open}Ccy>
      </${open}Acct>
      <${open}FrToDt>
        <${open}FrDtTm>2026-01-01T00:00:00</${open}FrDtTm>
        <${open}ToDtTm>2026-01-31T23:59:59</${open}ToDtTm>
      </${open}FrToDt>
      <${open}Bal>
        <${open}Tp><${open}CdOrPrtry><${open}Cd>OPBD</${open}Cd></${open}CdOrPrtry></${open}Tp>
        <${open}Amt Ccy="CHF">1000.00</${open}Amt>
        <${open}CdtDbtInd>CRDT</${open}CdtDbtInd>
      </${open}Bal>
      <${open}Bal>
        <${open}Tp><${open}CdOrPrtry><${open}Cd>CLBD</${open}Cd></${open}CdOrPrtry></${open}Tp>
        <${open}Amt Ccy="CHF">1500.00</${open}Amt>
        <${open}CdtDbtInd>CRDT</${open}CdtDbtInd>
      </${open}Bal>
      ${entries}
    </${open}Stmt>
  </${open}BkToCstmrStmt>
</${open}Document>`;
}

const DEBIT_ENTRY = `
  <Ntry>
    <Amt Ccy="CHF">82.40</Amt>
    <CdtDbtInd>DBIT</CdtDbtInd>
    <Sts>BOOK</Sts>
    <BookgDt><Dt>2026-01-05</Dt></BookgDt>
    <ValDt><Dt>2026-01-06</Dt></ValDt>
    <AcctSvcrRef>REF-001</AcctSvcrRef>
    <NtryDtls>
      <TxDtls>
        <Refs><EndToEndId>E2E-001</EndToEndId></Refs>
        <RltdPties><Cdtr><Nm>Migros Zürich</Nm></Cdtr></RltdPties>
        <RmtInf><Ustrd>Einkauf Lebensmittel</Ustrd></RmtInf>
      </TxDtls>
    </NtryDtls>
  </Ntry>`;

const CREDIT_ENTRY = `
  <Ntry>
    <Amt Ccy="CHF">6800.00</Amt>
    <CdtDbtInd>CRDT</CdtDbtInd>
    <Sts>BOOK</Sts>
    <BookgDt><Dt>2026-01-25</Dt></BookgDt>
    <NtryDtls>
      <TxDtls>
        <RltdPties><Dbtr><Nm>Arbeitgeber AG</Nm></Dbtr></RltdPties>
        <RmtInf><Ustrd>Lohn Januar</Ustrd></RmtInf>
      </TxDtls>
    </NtryDtls>
  </Ntry>`;

describe("parseCamt053", () => {
  it("reads the account, period and balances", () => {
    const result = parseCamt053(camt(DEBIT_ENTRY));
    expect(result.iban).toBe("CH9300762011623852957");
    expect(result.currency).toBe("CHF");
    expect(result.periodFrom).toBe("2026-01-01");
    expect(result.periodTo).toBe("2026-01-31");
    expect(result.openingBalanceCents).toBe(100000);
    expect(result.closingBalanceCents).toBe(150000);
  });

  it("signs a debit negative and a credit positive", () => {
    const result = parseCamt053(camt(DEBIT_ENTRY + CREDIT_ENTRY));
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0].amountCents).toBe(-8240);
    expect(result.transactions[1].amountCents).toBe(680000);
  });

  it("takes the counterparty from the side the money moved to or from", () => {
    const result = parseCamt053(camt(DEBIT_ENTRY + CREDIT_ENTRY));
    // Debit → the creditor received the money.
    expect(result.transactions[0].counterparty).toBe("Migros Zürich");
    // Credit → the debtor sent it.
    expect(result.transactions[1].counterparty).toBe("Arbeitgeber AG");
  });

  it("prefers the remittance information as the description", () => {
    const result = parseCamt053(camt(DEBIT_ENTRY));
    expect(result.transactions[0].description).toBe("Einkauf Lebensmittel");
    expect(result.transactions[0].bankReference).toBe("REF-001");
  });

  it("uses the booking date, not the value date", () => {
    const result = parseCamt053(camt(DEBIT_ENTRY));
    expect(result.transactions[0].date).toBe("2026-01-05");
  });

  it("handles namespace-prefixed documents", () => {
    const result = parseCamt053(camt(DEBIT_ENTRY, { namespace: "ns2" }));
    expect(result.transactions).toHaveLength(1);
    expect(result.iban).toBe("CH9300762011623852957");
  });

  it("splits a collective booking into its individual transactions", () => {
    const collective = `
      <Ntry>
        <Amt Ccy="CHF">150.00</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-01-10</Dt></BookgDt>
        <NtryDtls>
          <TxDtls>
            <Amt Ccy="CHF">100.00</Amt>
            <CdtDbtInd>DBIT</CdtDbtInd>
            <RmtInf><Ustrd>Teil A</Ustrd></RmtInf>
          </TxDtls>
          <TxDtls>
            <Amt Ccy="CHF">50.00</Amt>
            <CdtDbtInd>DBIT</CdtDbtInd>
            <RmtInf><Ustrd>Teil B</Ustrd></RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>`;
    const result = parseCamt053(camt(collective));
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions.map((t) => t.amountCents)).toEqual([-10000, -5000]);
    expect(result.transactions.map((t) => t.description)).toEqual(["Teil A", "Teil B"]);
  });

  it("does not leak the collective booking's own reference onto split legs without one", () => {
    // The Ntry-level AcctSvcrRef belongs to the collective booking as a whole.
    // Falling back to it per split leg would give both legs the same
    // bankReference, which collapses their import fingerprints onto one hash
    // (see lib/import/dedupe.ts) and makes the second leg look like a
    // duplicate of the first.
    const collective = `
      <Ntry>
        <Amt Ccy="CHF">150.00</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-01-10</Dt></BookgDt>
        <AcctSvcrRef>COLLECTIVE-REF</AcctSvcrRef>
        <NtryDtls>
          <TxDtls>
            <Amt Ccy="CHF">100.00</Amt>
            <CdtDbtInd>DBIT</CdtDbtInd>
            <RmtInf><Ustrd>Teil A</Ustrd></RmtInf>
          </TxDtls>
          <TxDtls>
            <Amt Ccy="CHF">50.00</Amt>
            <CdtDbtInd>DBIT</CdtDbtInd>
            <RmtInf><Ustrd>Teil B</Ustrd></RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>`;
    const result = parseCamt053(camt(collective));
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions.map((t) => t.bankReference)).toEqual([null, null]);
  });

  it("still uses a split leg's own reference when it has one", () => {
    const collective = `
      <Ntry>
        <Amt Ccy="CHF">150.00</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-01-10</Dt></BookgDt>
        <AcctSvcrRef>COLLECTIVE-REF</AcctSvcrRef>
        <NtryDtls>
          <TxDtls>
            <Refs><AcctSvcrRef>LEG-A</AcctSvcrRef></Refs>
            <Amt Ccy="CHF">100.00</Amt>
            <CdtDbtInd>DBIT</CdtDbtInd>
            <RmtInf><Ustrd>Teil A</Ustrd></RmtInf>
          </TxDtls>
          <TxDtls>
            <Refs><AcctSvcrRef>LEG-B</AcctSvcrRef></Refs>
            <Amt Ccy="CHF">50.00</Amt>
            <CdtDbtInd>DBIT</CdtDbtInd>
            <RmtInf><Ustrd>Teil B</Ustrd></RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>`;
    const result = parseCamt053(camt(collective));
    expect(result.transactions.map((t) => t.bankReference)).toEqual(["LEG-A", "LEG-B"]);
  });

  it("treats a literal NOTPROVIDED InstrId as no reference at all", () => {
    // Card/ATM bookings without a real SEPA reference get "NOTPROVIDED" in
    // InstrId as well as EndToEndId — not just EndToEndId. Accepting it as a
    // real reference would give every such booking the same bankReference,
    // colliding two genuinely distinct withdrawals onto one import fingerprint.
    const atmWithdrawal = `
      <Ntry>
        <Amt Ccy="CHF">50.00</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-01-22</Dt></BookgDt>
        <NtryDtls>
          <TxDtls>
            <Refs><InstrId>NOTPROVIDED</InstrId><EndToEndId>NOTPROVIDED</EndToEndId></Refs>
            <RmtInf><Ustrd>Bancomatbezug</Ustrd></RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>`;
    const result = parseCamt053(camt(atmWithdrawal));
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].bankReference).toBeNull();
  });

  it("skips entries that are not booked yet", () => {
    const pending = DEBIT_ENTRY.replace("<Sts>BOOK</Sts>", "<Sts>PDNG</Sts>");
    const result = parseCamt053(camt(pending));
    expect(result.transactions).toHaveLength(0);
    expect(result.warnings.join(" ")).toContain("nicht verbuchte");
  });

  it("rejects a document that is not a CAMT.053 statement", () => {
    const camt054 = `<?xml version="1.0"?><Document><BkToCstmrDbtCdtNtfctn/></Document>`;
    expect(() => parseCamt053(camt054)).toThrow(/CAMT\.054|BkToCstmrStmt/);
  });

  it("rejects unparseable XML with a readable message", () => {
    expect(() => parseCamt053("<Document><unclosed>")).toThrow();
  });
});
