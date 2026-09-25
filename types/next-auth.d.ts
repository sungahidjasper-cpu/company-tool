import type { UserRole } from "@/lib/generated/prisma/enums";

declare module "next-auth" {
  interface User {
    id: string;
    firstName: string;
    lastName: string;
    role: UserRole;
    companyId: string;
    avatar: string | null;
    /** Not exposed on Session.user — only ever read/written on the JWT, see jwt callback in auth.config.ts. */
    securityVersion: number;
  }

  interface Session {
    user: User;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    firstName: string;
    lastName: string;
    role: UserRole;
    companyId: string;
    avatar: string | null;
    /** Compared against the live User.securityVersion on every getServerSession() call; a mismatch invalidates the session. */
    securityVersion: number;
  }
}
