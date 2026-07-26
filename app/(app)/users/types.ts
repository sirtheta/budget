import type { UserRole } from "@prisma/client";

/**
 * The subset of `User` the user-management UI needs.
 *
 * Deliberately narrower than Prisma's `User`: the rows are handed to Client
 * Components, so every field listed here is serialized into the RSC payload
 * and delivered to the browser. `passwordHash`, `twoFactorSecret` and
 * `twoFactorBackupCodes` must never appear in that payload — typing the props
 * as `User` is what previously shipped them.
 */
export interface UserListItem {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
}
