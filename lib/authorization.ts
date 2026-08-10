import type { UserRole } from "@/lib/generated/prisma/enums";

export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to perform this action.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

type SessionUser = {
  id: string;
  role: UserRole;
  companyId: string;
};

const ROLE_RANK: Record<UserRole, number> = {
  EMPLOYEE: 0,
  MANAGER: 1,
  ADMIN: 2,
  SUPER_ADMIN: 3,
};

export function hasMinimumRole(role: UserRole, minimum: UserRole) {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export function isSuperAdmin(role: UserRole) {
  return role === "SUPER_ADMIN";
}

/**
 * The permission matrix for Phase 4's modules. Centralized here so every
 * Server Action and page checks the exact same rules — UI-level hiding of
 * controls is cosmetic only and never a substitute for this.
 *
 * Company = tenant in this schema, so creating/archiving one is
 * platform-admin-only; everything else requires at least a Manager.
 */
export const Permissions = {
  manageCompanies: (role: UserRole) => isSuperAdmin(role),
  manageUsers: (role: UserRole) => hasMinimumRole(role, "ADMIN"),
  manageClients: (role: UserRole) => hasMinimumRole(role, "MANAGER"),
  manageProjects: (role: UserRole) => hasMinimumRole(role, "MANAGER"),
  manageLeads: (role: UserRole) => hasMinimumRole(role, "MANAGER"),
};

export function hasCompanyAccess(user: SessionUser, companyId: string) {
  return isSuperAdmin(user.role) || user.companyId === companyId;
}

/**
 * For Server Actions: return a boolean and let the caller produce a clean
 * ActionResult error, rather than an uncaught exception reaching the client.
 */
export function canAccessCompany(user: SessionUser, companyId: string) {
  return hasCompanyAccess(user, companyId);
}

/**
 * For Server Components: throws, to be caught by the nearest error.tsx —
 * pages don't return an ActionResult, so this is the idiomatic shape there.
 */
export function assertCompanyAccess(user: SessionUser, companyId: string) {
  if (!hasCompanyAccess(user, companyId)) {
    throw new ForbiddenError(
      "You do not have access to this company's data."
    );
  }
}

export function assertPermission(
  user: SessionUser,
  check: (role: UserRole) => boolean
) {
  if (!check(user.role)) {
    throw new ForbiddenError();
  }
}
