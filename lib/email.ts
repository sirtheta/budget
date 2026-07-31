import nodemailer from "nodemailer";
import type { SystemSettings } from "@prisma/client";
import { decryptSecret } from "@/lib/crypto";
import logger from "@/lib/logger";

const log = logger.child({ module: "email" });

type TransportSettings = Pick<SystemSettings, "smtpHost" | "smtpPort" | "smtpUser">;

/** `password` is always plaintext — callers decrypt a stored secret before calling in. */
function buildTransport(settings: TransportSettings, password: string) {
  if (!settings.smtpHost || !settings.smtpUser || !password) {
    throw new Error("SMTP nicht konfiguriert. Bitte SMTP-Einstellungen hinterlegen.");
  }
  return nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort ?? 587,
    secure: (settings.smtpPort ?? 587) === 465,
    auth: {
      user: settings.smtpUser,
      pass: password,
    },
  });
}

/**
 * Renders a plain-text body as HTML with a `format-detection` meta tag, so
 * mail clients (notably iOS/Apple Mail) don't turn recognized dates, phone
 * numbers, or addresses into auto-generated links.
 */
function toHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
  return `<!DOCTYPE html><html><head><meta name="format-detection" content="date=no, telephone=no, address=no, email=no"></head><body style="font-family: sans-serif; white-space: pre-wrap;">${escaped}</body></html>`;
}

/**
 * Escapes a display name for a quoted-string in an address header: a literal
 * quote or backslash inside it would otherwise end the quoting early. Settings
 * validation already rejects newlines (see saveSettingsAction); this covers the
 * rest, including rows written before that validation existed.
 */
function quoteDisplayName(name: string): string {
  return name.replace(/[\\"]/g, "\\$&").replace(/[\r\n]/g, " ");
}

/** Checks that the SMTP account can be reached and authenticated, without sending anything. */
export async function testConnection(settings: TransportSettings, password: string): Promise<void> {
  const transporter = buildTransport(settings, password);
  await transporter.verify();
}

/** Sends a plain-text mail through the configured SMTP account. */
export async function sendMail(
  settings: SystemSettings,
  to: string,
  subject: string,
  text: string
): Promise<void> {
  if (process.env.DISABLE_EMAIL === "true") {
    log.info("E-Mail-Versand deaktiviert (DISABLE_EMAIL=true)");
    return;
  }
  const transporter = buildTransport(settings, decryptSecret(settings.smtpPassword ?? ""));
  const fromName = settings.smtpFromName || settings.smtpUser!;
  const fromAddress = settings.smtpFromAddress || settings.smtpUser!;
  await transporter.sendMail({
    from: `"${quoteDisplayName(fromName)}" <${fromAddress}>`,
    to,
    subject,
    text,
    html: toHtml(text),
  });
}
