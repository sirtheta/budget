import { UserRole } from "@prisma/client";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
    } & DefaultSession["user"];
  }

  interface User {
    role: UserRole;
    /** Credential epoch the session was issued under (see User.sessionEpoch). */
    sessionEpoch?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: UserRole;
    /** Epoch ms of the last DB re-check of role/isActive (see jwt callback). */
    roleCheckedAt?: number;
    /**
     * Value of `User.sessionEpoch` when this token was issued. The jwt callback
     * kills the session once the stored value no longer matches, which is how a
     * password reset revokes tokens that were already out there.
     */
    sessionEpoch?: number;
  }
}
