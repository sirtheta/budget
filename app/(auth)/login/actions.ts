"use server";

import { signIn } from "@/lib/auth";
import { AuthError } from "next-auth";
import logger from "@/lib/logger";

const log = logger.child({ module: "login" });

export async function loginAction(
  _prevState: { error?: string } | undefined,
  formData: FormData
): Promise<{ error?: string }> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/dashboard",
    });
    return {};
  } catch (err) {
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
