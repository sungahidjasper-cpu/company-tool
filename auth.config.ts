import type { NextAuthOptions } from "next-auth";

import { prisma } from "@/lib/prisma";

/**
 * The provider-agnostic slice of the NextAuth config. Kept separate from
 * lib/auth.ts so the Credentials provider's Prisma/bcrypt-dependent
 * authorize() callback lives in exactly one place, not duplicated here. The
 * jwt callback below also touches Prisma (for the securityVersion check) —
 * that's a session-validity concern, not provider-specific credential
 * logic, so it stays here rather than duplicating this callback in
 * lib/auth.ts.
 */
export const authConfig: Omit<NextAuthOptions, "providers"> = {
  secret: process.env.NEXTAUTH_SECRET,
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.companyId = user.companyId;
        token.firstName = user.firstName;
        token.lastName = user.lastName;
        token.avatar = user.avatar;
        token.securityVersion = user.securityVersion;
        return token;
      }
      // Lets a self-service profile update (features/profile) refresh the
      // JWT without a full re-login, via useSession().update({...}) —
      // trusted here because the client only calls it right after its own
      // successful updateProfile() Server Action call.
      if (trigger === "update" && session) {
        token.firstName = session.firstName ?? token.firstName;
        token.lastName = session.lastName ?? token.lastName;
        token.email = session.email ?? token.email;
        token.avatar = session.avatar ?? token.avatar;
        return token;
      }
      // Every other call is a revalidation of an already-issued token (i.e.
      // every getServerSession()/getCurrentUser()/requireUser() call site in
      // the app). Comparing against the live database value here — rather
      // than only trusting what's embedded in the token — is what lets a
      // password reset or change kill every other session immediately,
      // without a database-backed session store: throwing here makes
      // NextAuth's own session route (core/routes/session.js) discard the
      // cookie and return no session, which requireUser() already treats as
      // "not logged in." Deliberately not caught anywhere: an uncaught throw
      // here is what makes the invalidation propagate.
      const current = await prisma.user.findUnique({
        where: { id: token.id },
        select: { securityVersion: true },
      });
      if (!current || current.securityVersion !== token.securityVersion) {
        throw new Error("Session security version mismatch");
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.companyId = token.companyId;
        session.user.firstName = token.firstName;
        session.user.lastName = token.lastName;
        session.user.avatar = token.avatar;
      }
      return session;
    },
  },
};
