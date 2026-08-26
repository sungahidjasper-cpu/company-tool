import { beforeEach, describe, expect, it, vi } from "vitest";

type MockPrisma = {
  user: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
};

function createMockPrisma(): MockPrisma {
  return {
    user: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn().mockResolvedValue(null),
    },
  };
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { prisma } from "@/lib/prisma";
import { listUsers, getUserById, listUserOptions } from "@/features/users/services/user.service";

const mockedPrisma = prisma as unknown as MockPrisma;

const COMPANY_A = "company-a";

beforeEach(() => {
  vi.clearAllMocks();
  mockedPrisma.user.findMany.mockResolvedValue([]);
  mockedPrisma.user.count.mockResolvedValue(0);
  mockedPrisma.user.findUnique.mockResolvedValue(null);
});

describe("listUsers", () => {
  it("1. scopes by companyId and excludes archived rows by default", async () => {
    await listUsers(COMPANY_A, {});
    const [{ where }] = mockedPrisma.user.findMany.mock.calls[0];
    expect(where.companyId).toBe(COMPANY_A);
    expect(where.deletedAt).toBeNull();
  });

  it("2. includes only archived rows when status=archived", async () => {
    await listUsers(COMPANY_A, { status: "archived" });
    const [{ where }] = mockedPrisma.user.findMany.mock.calls[0];
    expect(where.deletedAt).toEqual({ not: null });
    expect(where.status).toBeUndefined();
  });

  it("3. applies an uppercased status filter for a non-archived status value", async () => {
    await listUsers(COMPANY_A, { status: "suspended" });
    const [{ where }] = mockedPrisma.user.findMany.mock.calls[0];
    expect(where.status).toBe("SUSPENDED");
    expect(where.deletedAt).toBeNull();
  });

  it("4. applies a case-insensitive OR filter across firstName/lastName/email when q is set", async () => {
    await listUsers(COMPANY_A, { q: "jane" });
    const [{ where }] = mockedPrisma.user.findMany.mock.calls[0];
    expect(where.OR).toEqual([
      { firstName: { contains: "jane", mode: "insensitive" } },
      { lastName: { contains: "jane", mode: "insensitive" } },
      { email: { contains: "jane", mode: "insensitive" } },
    ]);
  });

  it("5. omits the OR filter when q is absent", async () => {
    await listUsers(COMPANY_A, {});
    const [{ where }] = mockedPrisma.user.findMany.mock.calls[0];
    expect(where.OR).toBeUndefined();
  });

  it("6. returns users, totalCount, page, and pageSize using the same where clause for both queries", async () => {
    mockedPrisma.user.findMany.mockResolvedValue([{ id: "u-1" }]);
    mockedPrisma.user.count.mockResolvedValue(1);

    const result = await listUsers(COMPANY_A, { page: "2" });

    expect(result).toEqual({ users: [{ id: "u-1" }], totalCount: 1, page: 2, pageSize: 10 });
    const [findManyArgs] = mockedPrisma.user.findMany.mock.calls[0];
    const [countArgs] = mockedPrisma.user.count.mock.calls[0];
    expect(findManyArgs.where).toEqual(countArgs.where);
    expect(findManyArgs.skip).toBe(10);
    expect(findManyArgs.take).toBe(10);
  });
});

describe("getUserById", () => {
  it("1. queries by id", async () => {
    await getUserById("user-1");
    const [args] = mockedPrisma.user.findUnique.mock.calls[0];
    expect(args.where).toEqual({ id: "user-1" });
  });

  it("2. includes targetedActivities ordered newest-first, capped at 20, with the actor's name (Phase 28)", async () => {
    await getUserById("user-1");
    const [args] = mockedPrisma.user.findUnique.mock.calls[0];
    expect(args.include.targetedActivities).toEqual({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { actor: { select: { firstName: true, lastName: true } } },
    });
  });

  it("3. includes ownedProjects and assignedProjects, each filtered to non-deleted and capped at 5", async () => {
    await getUserById("user-1");
    const [args] = mockedPrisma.user.findUnique.mock.calls[0];
    expect(args.include.ownedProjects).toEqual({ where: { deletedAt: null }, take: 5 });
    expect(args.include.assignedProjects).toEqual({ where: { deletedAt: null }, take: 5 });
  });

  it("4. returns whatever Prisma resolves, targetedActivities included", async () => {
    const targetUser = {
      id: "user-1",
      targetedActivities: [{ id: "act-1", action: "user.archived" }],
    };
    mockedPrisma.user.findUnique.mockResolvedValue(targetUser);

    const result = await getUserById("user-1");
    expect(result).toBe(targetUser);
    expect(result?.targetedActivities).toEqual([{ id: "act-1", action: "user.archived" }]);
  });
});

describe("listUserOptions", () => {
  it("1. scopes by companyId, excludes archived, and requires ACTIVE status", async () => {
    await listUserOptions(COMPANY_A);
    const [args] = mockedPrisma.user.findMany.mock.calls[0];
    expect(args.where).toEqual({ companyId: COMPANY_A, deletedAt: null, status: "ACTIVE" });
  });

  it("2. selects only id, firstName, and lastName", async () => {
    await listUserOptions(COMPANY_A);
    const [args] = mockedPrisma.user.findMany.mock.calls[0];
    expect(args.select).toEqual({ id: true, firstName: true, lastName: true });
  });

  it("3. orders by firstName ascending", async () => {
    await listUserOptions(COMPANY_A);
    const [args] = mockedPrisma.user.findMany.mock.calls[0];
    expect(args.orderBy).toEqual({ firstName: "asc" });
  });
});
