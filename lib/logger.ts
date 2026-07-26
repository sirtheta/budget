import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  // Default pino timestamps are a raw epoch integer, which is unreadable in
  // `docker logs`; ISO-8601 is both human-scannable and still greppable.
  timestamp: pino.stdTimeFunctions.isoTime,
  // Backstop for the day someone logs a whole settings row or form payload.
  // Nothing currently passes these keys, and that is the point — container logs
  // get shipped, retained and read by whatever collects them, so a credential
  // that reaches them has effectively left the application.
  redact: {
    paths: [
      "password",
      "*.password",
      "currentPassword",
      "*.currentPassword",
      "newPassword",
      "*.newPassword",
      "passwordHash",
      "*.passwordHash",
      "smtpPassword",
      "*.smtpPassword",
      "twoFactorSecret",
      "*.twoFactorSecret",
      "twoFactorBackupCodes",
      "*.twoFactorBackupCodes",
      "token",
      "*.token",
      "tokenHash",
      "*.tokenHash",
      "apiKey",
      "*.apiKey",
      "authorization",
      "*.authorization",
    ],
    censor: "[redacted]",
  },
});

/**
 * Masks the local part of an email address for logging: `n***@bluewin.ch`.
 *
 * Failed logins and password-reset requests are logged with the address that
 * was submitted, which is useful for working out what is happening to an
 * account — but it writes the household's addresses, and any address an
 * attacker sprays, into logs that outlive the request. The domain and first
 * character are enough to recognise which account a line refers to.
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "unknown";
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

export default logger;
