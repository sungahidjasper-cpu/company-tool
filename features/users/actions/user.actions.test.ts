import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/password", () => ({ hashPassword: vi.fn() }));

type MockPrisma = {
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

function createMockPrisma(): MockPrisma {
  return {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  };
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { requireUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import {
  createUser,
  updateUser,
  activateUser,
  suspendUser,
  archiveUser,
  restoreUser,
} from "@/features/users/actions/user.actions";

const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedLogActivity = logActivity as unknown as ReturnType<typeof vi.fn>;
const mockedHashPassword = hashPassword as unknown as ReturnType<typeof vi.fn>;
const mockedPrisma = prisma as unknown as MockPrisma;

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";

const SUPER_ADMIN = { id: "user-super", role: "SUPER_ADMIN", companyId: COMPANY_A };
const ADMIN = { id: "user-admin", role: "ADMIN", companyId: COMPANY_A };
const MANAGER = { id: "user-manager", role: "MANAGER", companyId: COMPANY_A };
const EMPLOYEE = { id: "user-employee", role: "EMPLOYEE", companyId: COMPANY_A };

function makeTargetUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "target-1",
    companyId: COMPANY_A,
    email: "target@acme.test",
    firstName: "Target",
    lastName: "User",
    role: "EMPLOYEE",
    status: "ACTIVE",
    deletedAt: null,
    ...overrides,
  };
}

const VALID_CREATE_INPUT = {
  email: "new@acme.test",
  firstName: "New",
  lastName: "Hire",
  password: "securepass123",
  role: "EMPLOYEE" as const,
};

const VALID_UPDATE_INPUT = {
  firstName: "Updated",
  lastName: "Name",
  role: "EMPLOYEE" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequireUser.mockResolvedValue(ADMIN);
  mockedHashPassword.mockResolvedValue("hashed-password");
  mockedPrisma.user.findUnique.mockResolvedValue(null);
  mockedPrisma.user.create.mockResolvedValue(makeTargetUser());
  mockedPrisma.user.update.mockResolvedValue(makeTargetUser());
});

describe("createUser", () => {
  it("1. rejects an EMPLOYEE — below the ADMIN minimum", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await createUser(VALID_CREATE_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/permission/i);
    expect(mockedPrisma.user.create).not.toHaveBeenCalled();
  });

  it("2. rejects a MANAGER — below the ADMIN minimum", async () => {
    mockedRequireUser.mockResolvedValue(MANAGER);
    const result = await createUser(VALID_CREATE_INPUT);
    expect(result.success).toBe(false);
    expect(mockedPrisma.user.create).not.toHaveBeenCalled();
  });

  it("3. succeeds for an ADMIN", async () => {
    const result = await createUser(VALID_CREATE_INPUT);
    expect(result.success).toBe(true);
  });

  it("4. rejects invalid input (bad email) without touching the database", async () => {
    const result = await createUser({ ...VALID_CREATE_INPUT, email: "not-an-email" });
    expect(result.success).toBe(false);
    expect(mockedPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.user.create).not.toHaveBeenCalled();
  });

  it("5. rejects granting SUPER_ADMIN when the actor is only an ADMIN", async () => {
    const result = await createUser({ ...VALID_CREATE_INPUT, role: "SUPER_ADMIN" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/super admin/i);
    expect(mockedPrisma.user.create).not.toHaveBeenCalled();
  });

  it("6. allows granting SUPER_ADMIN when the actor is a SUPER_ADMIN", async () => {
    mockedRequireUser.mockResolvedValue(SUPER_ADMIN);
    const result = await createUser({ ...VALID_CREATE_INPUT, role: "SUPER_ADMIN" });
    expect(result.success).toBe(true);
  });

  it("7. rejects a duplicate email without hashing the password or creating a row", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(makeTargetUser({ email: VALID_CREATE_INPUT.email }));
    const result = await createUser(VALID_CREATE_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/already exists/i);
    expect(mockedHashPassword).not.toHaveBeenCalled();
    expect(mockedPrisma.user.create).not.toHaveBeenCalled();
  });

  it("8. hashes the password and creates the user scoped to the actor's companyId, status ACTIVE", async () => {
    await createUser(VALID_CREATE_INPUT);
    expect(mockedHashPassword).toHaveBeenCalledWith(VALID_CREATE_INPUT.password);
    expect(mockedPrisma.user.create).toHaveBeenCalledWith({
      data: {
        companyId: ADMIN.companyId,
        email: VALID_CREATE_INPUT.email,
        firstName: VALID_CREATE_INPUT.firstName,
        lastName: VALID_CREATE_INPUT.lastName,
        role: VALID_CREATE_INPUT.role,
        passwordHash: "hashed-password",
        status: "ACTIVE",
      },
    });
  });

  it("9. logs user.created with the actor, company, new user id, and email", async () => {
    mockedPrisma.user.create.mockResolvedValue(makeTargetUser({ id: "new-user-1", email: VALID_CREATE_INPUT.email }));
    await createUser(VALID_CREATE_INPUT);
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: ADMIN.id,
      action: "user.created",
      companyId: ADMIN.companyId,
      userId: "new-user-1",
      metadata: { email: VALID_CREATE_INPUT.email },
    });
  });

  it("10. returns the new user's id on success", async () => {
    mockedPrisma.user.create.mockResolvedValue(makeTargetUser({ id: "new-user-1" }));
    const result = await createUser(VALID_CREATE_INPUT);
    expect(result).toEqual({ success: true, data: { id: "new-user-1" } });
  });
});

describe("updateUser", () => {
  it("1. rejects an EMPLOYEE/MANAGER — below the ADMIN minimum", async () => {
    mockedRequireUser.mockResolvedValue(MANAGER);
    const result = await updateUser("target-1", VALID_UPDATE_INPUT);
    expect(result.success).toBe(false);
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it("2. returns 'User not found.' when the target does not exist", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(null);
    const result = await updateUser("missing", VALID_UPDATE_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("User not found.");
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it("3. returns 'User not found.' when the target belongs to a different company (tenant isolation)", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(makeTargetUser({ companyId: COMPANY_B }));
    const result = await updateUser("target-1", VALID_UPDATE_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("User not found.");
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it("4. rejects invalid input", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(makeTargetUser());
    const result = await updateUser("target-1", { ...VALID_UPDATE_INPUT, firstName: "" });
    expect(result.success).toBe(false);
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it("5. rejects granting SUPER_ADMIN when the actor is only an ADMIN", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(makeTargetUser());
    const result = await updateUser("target-1", { ...VALID_UPDATE_INPUT, role: "SUPER_ADMIN" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/super admin/i);
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it("6. updates the target with the parsed data, logs user.updated, and returns success", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(makeTargetUser());
    mockedPrisma.user.update.mockResolvedValue(makeTargetUser({ id: "target-1", ...VALID_UPDATE_INPUT }));

    const result = await updateUser("target-1", VALID_UPDATE_INPUT);

    expect(mockedPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "target-1" },
      data: VALID_UPDATE_INPUT,
    });
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: ADMIN.id,
      action: "user.updated",
      companyId: ADMIN.companyId,
      userId: "target-1",
    });
    expect(result).toEqual({ success: true, data: { id: "target-1" } });
  });
});

describe("activateUser / suspendUser", () => {
  it("1. rejects a MANAGER (below the ADMIN minimum) for activate", async () => {
    mockedRequireUser.mockResolvedValue(MANAGER);
    const result = await activateUser("target-1");
    expect(result.success).toBe(false);
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it("2. rejects a MANAGER (below the ADMIN minimum) for suspend", async () => {
    mockedRequireUser.mockResolvedValue(MANAGER);
    const result = await suspendUser("target-1");
    expect(result.success).toBe(false);
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it("3. rejects an actor changing their own status", async () => {
    const result = await suspendUser(ADMIN.id);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/cannot change your own status/i);
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it("4. returns 'User not found.' for a missing target", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(null);
    const result = await activateUser("missing");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("User not found.");
  });

  it("5. returns 'User not found.' for a cross-company target (tenant isolation)", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(makeTargetUser({ companyId: COMPANY_B }));
    const result = await activateUser("target-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("User not found.");
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it("6. activateUser sets status ACTIVE and logs user.activated", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(makeTargetUser({ status: "SUSPENDED" }));
    const result = await activateUser("target-1");

    expect(mockedPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "target-1" },
      data: { status: "ACTIVE" },
    });
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: ADMIN.id,
      action: "user.activated",
      companyId: ADMIN.companyId,
      userId: "target-1",
    });
    expect(result.success).toBe(true);
  });

  it("7. suspendUser sets status SUSPENDED and logs user.suspended", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(makeTargetUser({ status: "ACTIVE" }));
    const result = await suspendUser("target-1");

    expect(mockedPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "target-1" },
      data: { status: "SUSPENDED" },
    });
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: ADMIN.id,
      action: "user.suspended",
      companyId: ADMIN.companyId,
      userId: "target-1",
    });
    expect(result.success).toBe(true);
  });
});

describe("archiveUser", () => {
  it("1. rejects a MANAGER (below the ADMIN minimum)", async () => {
    mockedRequireUser.mockResolvedValue(MANAGER);
    const result = await archiveUser("target-1");
    expect(result.success).toBe(false);
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it("2. rejects an actor archiving their own account", async () => {
    const result = await archiveUser(ADMIN.id);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/cannot archive your own account/i);
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it("3. returns 'User not found.' for a missing target", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(null);
    const result = await archiveUser("missing");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("User not found.");
  });

  it("4. returns 'User not found.' for a cross-company target (tenant isolation)", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(makeTargetUser({ companyId: COMPANY_B }));
    const result = await archiveUser("target-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("User not found.");
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it("5. sets deletedAt to a Date instance and logs user.archived", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(makeTargetUser());
    const result = await archiveUser("target-1");

    const [{ data }] = mockedPrisma.user.update.mock.calls[0];
    expect(Object.keys(data)).toEqual(["deletedAt"]);
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: ADMIN.id,
      action: "user.archived",
      companyId: ADMIN.companyId,
      userId: "target-1",
    });
    expect(result.success).toBe(true);
  });
});

describe("restoreUser", () => {
  it("1. rejects a MANAGER (below the ADMIN minimum)", async () => {
    mockedRequireUser.mockResolvedValue(MANAGER);
    const result = await restoreUser("target-1");
    expect(result.success).toBe(false);
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it("2. returns 'User not found.' for a missing target", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(null);
    const result = await restoreUser("missing");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("User not found.");
  });

  it("3. returns 'User not found.' for a cross-company target (tenant isolation)", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(makeTargetUser({ companyId: COMPANY_B }));
    const result = await restoreUser("target-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("User not found.");
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it("4. sets deletedAt to null and logs user.restored", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(makeTargetUser({ deletedAt: new Date() }));
    const result = await restoreUser("target-1");

    expect(mockedPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "target-1" },
      data: { deletedAt: null },
    });
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: ADMIN.id,
      action: "user.restored",
      companyId: ADMIN.companyId,
      userId: "target-1",
    });
    expect(result.success).toBe(true);
  });

  it("5. allows restoring a user's own account (no self-check on restore)", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(makeTargetUser({ id: ADMIN.id, deletedAt: new Date() }));
    const result = await restoreUser(ADMIN.id);
    expect(result.success).toBe(true);
    expect(mockedPrisma.user.update).toHaveBeenCalled();
  });
});
