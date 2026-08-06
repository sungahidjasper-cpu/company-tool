import type { UserRole } from "@/lib/generated/prisma/enums";

declare module "next-auth" {
  interface User {
    id: string;
    firstName: string;
    lastName: string;
    role: UserRole;
    companyId: string;
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
  }
}
