import type { NextAuthOptions } from "next-auth";

/**
 * The provider-agnostic slice of the NextAuth config. Kept separate from
 * lib/auth.ts so the Credentials provider's Prisma/bcrypt-dependent
 * authorize() callback lives in exactly one place, not duplicated here.
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
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.companyId = user.companyId;
        token.firstName = user.firstName;
        token.lastName = user.lastName;
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
      }
      return session;
    },
  },
};
