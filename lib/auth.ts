import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { UserRole } from "@prisma/client";
import { dummyCompare } from "@/lib/password";
import logger from "@/lib/logger";
import { checkRateLimit, resetRateLimit } from "@/lib/rate-limit";
import { config } from "@/lib/config";

const log = logger.child({ module: "auth" });

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "E-Mail", type: "email" },
        password: { label: "Passwort", type: "password" },
      },
      async authorize(credentials, request) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;

        // Normalized only for the rate-limit key (DB lookup stays exact),
        // so "User@x.ch" and "user@x.ch " share one bucket.
        const rateLimitKey = `login:${email.trim().toLowerCase()}`;
        // Broader per-IP bucket: limits spraying many accounts from one IP
        // without letting one IP lock out a shared office network.
        const ip =
          request?.headers?.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
        const ipAllowed = checkRateLimit(`login-ip:${ip}`, {
          maxAttempts: config.rateLimit.maxAttempts * 10,
        });
        if (!checkRateLimit(rateLimitKey) || !ipAllowed) {
          log.warn({ email, ip }, "login blocked: rate limit exceeded");
          return null;
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.isActive) {
          // Equalize response time with the real password check so the
          // duration does not reveal whether the email exists.
          await dummyCompare(password);
          log.warn({ email }, "login failed: user not found or inactive");
          return null;
        }

        const passwordValid = await compare(password, user.passwordHash);
        if (!passwordValid) {
          log.warn({ email }, "login failed: wrong password");
          return null;
        }

        resetRateLimit(rateLimitKey);
        log.info({ email, userId: user.id }, "login success");
        return {
          id: String(user.id),
          name: user.name,
          email: user.email,
          role: user.role,
        };
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: config.session.maxAgeSec,
    updateAge: config.session.updateAgeSec,
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role: UserRole }).role;
        token.roleCheckedAt = Date.now();
        return token;
      }
      // Re-validate against the DB so demotion, deactivation, or a profile
      // edit (name/email) takes effect within a minute instead of only at
      // JWT expiry (default 7 days) / next login. Returning null invalidates
      // the session.
      const ROLE_RECHECK_MS = 60_000;
      const checkedAt = typeof token.roleCheckedAt === "number" ? token.roleCheckedAt : 0;
      if (Date.now() - checkedAt > ROLE_RECHECK_MS) {
        const userId = parseInt(String(token.id), 10);
        if (!Number.isInteger(userId)) return null;
        const dbUser = await prisma.user.findUnique({
          where: { id: userId },
          select: { role: true, isActive: true, name: true, email: true },
        });
        if (!dbUser || !dbUser.isActive) {
          log.info({ userId: token.id }, "session invalidated: user missing or inactive");
          return null;
        }
        token.role = dbUser.role;
        token.name = dbUser.name;
        token.email = dbUser.email;
        token.roleCheckedAt = Date.now();
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id as string;
      session.user.role = token.role as UserRole;
      session.user.name = token.name as string;
      session.user.email = token.email as string;
      return session;
    },
  },
});
