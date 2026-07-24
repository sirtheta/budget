import type { AuditLog } from "@prisma/client";
import { formatDateCH } from "@/lib/date";
import { formatMoney } from "@/lib/money";

const ACTION_LABELS: Record<string, string> = {
  CREATE: "Erstellt",
  UPDATE: "Geändert",
  DELETE: "Gelöscht",
  IMPORT: "Importiert",
  AUTOMATIC: "Automatisch gebucht",
  SETTINGS: "Einstellungen geändert",
};

const ENTITY_LABELS: Record<string, string> = {
  Transaction: "Buchung",
  Account: "Konto",
  Category: "Kategorie",
  Budget: "Budget",
  Reserve: "Rückstellung",
  SavingsGoal: "Sparziel",
  RecurringTransaction: "Wiederkehrende Buchung",
  ImportRule: "Importregel",
  CsvMapping: "CSV-Mapping",
  User: "Benutzer",
  Settings: "Systemeinstellungen",
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export function entityLabel(entityType: string): string {
  return ENTITY_LABELS[entityType] ?? entityType;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/** Human-readable (German) one-line description of an audit log's details. */
export function describeAuditLog(log: AuditLog): string {
  let details: Record<string, unknown> = {};
  try {
    details = log.details ? JSON.parse(log.details) : {};
  } catch {
    return log.details ?? "—";
  }

  if (log.entityType === "Transaction") {
    const date = asString(details.date);
    const amount = asNumber(details.amountCents);
    const parts = [
      date ? formatDateCH(date) : undefined,
      asString(details.description),
      amount !== undefined ? formatMoney(amount, { withCurrency: true }) : undefined,
    ].filter(Boolean);
    if (details.transfer) return `Umbuchung: ${parts.join(", ")}`;
    if (parts.length) return parts.join(", ");
  }

  if (log.entityType === "Transaction" && log.action === "IMPORT") {
    return `${details.imported ?? 0} importiert, ${details.skipped ?? 0} Duplikate übersprungen (${details.filename ?? "Datei"})`;
  }

  if (log.entityType === "Budget") {
    const amount = asNumber(details.amountCents);
    return [
      asString(details.categoryName),
      details.year && details.month ? `${details.month}/${details.year}` : undefined,
      amount !== undefined ? formatMoney(amount, { withCurrency: true }) : undefined,
    ]
      .filter(Boolean)
      .join(", ");
  }

  if (log.entityType === "Account" || log.entityType === "Category") {
    const name = asString(details.name);
    if (name && "isActive" in details) {
      return `${name} — ${details.isActive ? "aktiviert" : "deaktiviert"}`;
    }
    if (name) return name;
  }

  if (log.entityType === "User") {
    if ("email" in details) return `E-Mail: ${details.email}`;
    if ("isActive" in details) return details.isActive ? "Aktiviert" : "Deaktiviert";
    if ("role" in details) return `Rolle: ${details.role}`;
  }

  const keys = Object.keys(details);
  return keys.length ? JSON.stringify(details) : "—";
}
