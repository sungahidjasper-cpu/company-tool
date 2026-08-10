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
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.companyId = user.companyId;
        token.firstName = user.firstName;
        token.lastName = user.lastName;
        token.avatar = user.avatar;
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
