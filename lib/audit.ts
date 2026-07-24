import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { config } from "@/lib/config";
import type { PrismaClient } from "@prisma/client";
import type { Session } from "next-auth";

const log = logger.child({ module: "audit" });

export type AuditAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "IMPORT"
  | "AUTOMATIC"
  | "SETTINGS";

export type AuditEntity =
  | "Transaction"
  | "Account"
  | "Category"
  | "Budget"
  | "Reserve"
  | "SavingsGoal"
  | "RecurringTransaction"
  | "ImportRule"
  | "CsvMapping"
  | "User"
  | "Settings";

export async function logAudit(
  session: Session,
  action: AuditAction,
  entityType: AuditEntity,
  entityId?: number,
  details?: Record<string, unknown>
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: parseInt(session.user.id, 10),
        userName: session.user.name ?? session.user.email ?? "Unbekannt",
        action,
        entityType,
        entityId: entityId ?? null,
        details: details ? JSON.stringify(details) : null,
      },
    });
  } catch (err) {
    // Audit logging must never break the main operation, but a silent
    // failure would hide that the trail has gaps — surface it to the log.
    log.error({ err, action, entityType, entityId }, "Failed to write audit log");
  }
}

/**
 * Deletes AuditLog rows older than the retention window
 * (AUDIT_RETENTION_DAYS, 0 = keep forever). Returns the number deleted.
 */
export async function pruneExpiredAuditLogs(
  client: PrismaClient = prisma,
  now = new Date()
): Promise<number> {
  const days = config.audit.retentionDays;
  if (days <= 0) return 0;
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const { count } = await client.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  if (count > 0) log.info({ count, days }, "Pruned expired audit logs");
  return count;
}
