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
}
