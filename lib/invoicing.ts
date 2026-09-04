import type { Session } from "next-auth";
import { config } from "@/lib/config";
import { logAudit } from "@/lib/audit";
import logger from "@/lib/logger";

const log = logger.child({ module: "invoicing" });

/**
 * Sends an income transaction's description/amount to CustomerManagement so
 * it can mark a matching open invoice as paid. A no-op when the integration
 * isn't configured. Never throws — a slow or unreachable sibling app must
 * never fail an import.
 */
export async function matchInvoicePayment(
  session: Session,
  params: { transactionId: number; description: string; amountCents: number; bookingDate: string }
): Promise<void> {
  if (!config.customerManagement.url) return;

  try {
    const res = await fetch(`${config.customerManagement.url}/api/external/payments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.customerManagement.apiKey ?? "",
      },
      body: JSON.stringify({
        description: params.description,
        amountRappen: params.amountCents,
        bookingDate: params.bookingDate,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`CustomerManagement responded ${res.status}`);

    const contentType = res.headers?.get("content-type");
    if (contentType && !contentType.toLowerCase().includes("application/json")) {
      throw new Error(`CustomerManagement returned non-JSON response (${res.status}, ${contentType})`);
    }

    const result = (await res.json()) as { matched: boolean; documentNumber?: string };
    if (result.matched) {
      await logAudit(session, "UPDATE", "Transaction", params.transactionId, {
        note: `CustomerManagement-Rechnung ${result.documentNumber} als bezahlt markiert`,
      });
    }
  } catch (err) {
    log.warn({ err, transactionId: params.transactionId }, "Failed to match invoice payment in CustomerManagement");
  }
}
