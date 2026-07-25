"use server";

import { signIn } from "@/lib/auth";
import { AuthError, CredentialsSignin } from "next-auth";
import logger from "@/lib/logger";

const log = logger.child({ module: "login" });

export type LoginState = { error?: string; needsTwoFactor?: boolean };

export async function loginAction(
  _prevState: LoginState | undefined,
  formData: FormData
): Promise<LoginState> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      code: formData.get("code") ?? undefined,
      redirectTo: "/dashboard",
    });
    return {};
  } catch (err) {
    if (err instanceof CredentialsSignin) {
      if (err.code === "two-factor-required") return { needsTwoFactor: true };
      if (err.code === "invalid-two-factor-code") {
        return { needsTwoFactor: true, error: "Code ist ungültig oder abgelaufen." };
      }
      return { error: "E-Mail oder Passwort ist falsch." };
    }
    if (err instanceof AuthError) {
      return { error: "E-Mail oder Passwort ist falsch." };
    }
    // A successful signIn() throws Next.js's internal NEXT_REDIRECT control-flow
    // error (digest-tagged) to perform the redirect — not a real failure.
    const isRedirect = err instanceof Error && "digest" in err && typeof err.digest === "string" && err.digest.startsWith("NEXT_REDIRECT");
    if (!isRedirect) log.error({ err }, "Unexpected error during login");
    throw err;
  }
}
