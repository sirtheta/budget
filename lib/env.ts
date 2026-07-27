// Values from older docker-compose/.env.example templates that are public
// knowledge (anyone with the repo knows them) and must never run in production.
const KNOWN_PLACEHOLDER_PATTERNS = [/INSECURE-DEFAULT/i, /ersetzen-mit/i, /CHANGE-ME/i];

function isPlaceholder(value: string): boolean {
  return KNOWN_PLACEHOLDER_PATTERNS.some((p) => p.test(value));
}

export function validateEnv(): void {
  if (process.env.NODE_ENV !== "production") return;
  const required = ["AUTH_SECRET", "ENCRYPTION_KEY"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        "In Docker these are auto-generated at startup; otherwise generate them as described in .env.example."
    );
  }
  for (const key of required) {
    if (isPlaceholder(process.env[key]!)) {
      throw new Error(
        `${key} is set to a publicly known placeholder value. ` +
          "Generate a real secret (see .env.example) or unset it to have one generated automatically in Docker."
      );
    }
  }
  if ((process.env.AUTH_SECRET?.length ?? 0) < 32) {
    throw new Error("AUTH_SECRET must be at least 32 characters");
  }
  if ((process.env.ENCRYPTION_KEY?.length ?? 0) < 32) {
    throw new Error("ENCRYPTION_KEY must be at least 32 characters (e.g. 32 random bytes hex-encoded)");
  }
  warnIfInsecureAuthUrl();
}

/**
 * Warns when the app runs in production without an https AUTH_URL.
 *
 * NextAuth decides from this value whether to mark the session cookie `Secure`
 * (and use the `__Secure-` prefix that proxy.ts looks for). The docker-compose
 * default is `http://localhost:3000`, which is right for a direct local run —
 * but put that container behind an HTTPS reverse proxy without updating the
 * value and the cookie ships without `Secure` while the app advertises HSTS.
 * The session then travels in the clear over any plain-http request that
 * reaches the host.
 *
 * A warning rather than an error: serving this over plain http on a trusted LAN
 * is a legitimate way to run a household app, and refusing to boot would break
 * those installations.
 */
function warnIfInsecureAuthUrl(): void {
  const authUrl = process.env.AUTH_URL;
  if (authUrl && authUrl.startsWith("https://")) return;
  console.warn(
    `[env] AUTH_URL is ${authUrl ? `"${authUrl}"` : "not set"} — the session cookie will not be ` +
      "marked Secure. If this instance is reachable over HTTPS (e.g. behind a reverse proxy), " +
      "set AUTH_URL to its https:// address so the cookie cannot leak over plain http."
  );
}
