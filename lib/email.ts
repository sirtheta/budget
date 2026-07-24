import nodemailer from "nodemailer";
import type { SystemSettings } from "@prisma/client";
import { decryptSecret } from "@/lib/crypto";
import logger from "@/lib/logger";

const log = logger.child({ module: "email" });

function buildTransport(settings: SystemSettings) {
  if (!settings.smtpHost || !settings.smtpUser || !settings.smtpPassword) {
    throw new Error("SMTP nicht konfiguriert. Bitte SMTP-Einstellungen hinterlegen.");
  }
  return nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort ?? 587,
    secure: (settings.smtpPort ?? 587) === 465,
    auth: {
      user: settings.smtpUser,
      pass: decryptSecret(settings.smtpPassword),
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
  const transporter = buildTransport(settings);
  const fromName = settings.smtpFromName || settings.smtpUser!;
  const fromAddress = settings.smtpFromAddress || settings.smtpUser!;
  await transporter.sendMail({
    from: `"${fromName}" <${fromAddress}>`,
    to,
    subject,
    text,
    html: toHtml(text),
  });
}
