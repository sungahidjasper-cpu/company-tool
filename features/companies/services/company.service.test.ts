import { beforeEach, describe, expect, it, vi } from "vitest";

type MockPrisma = {
  company: { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
  user: { count: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  project: { count: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  client: { count: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  activity: { findMany: ReturnType<typeof vi.fn> };
};

function createMockPrisma(): MockPrisma {
  return {
    company: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    user: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
    project: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
    client: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
    activity: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { prisma } from "@/lib/prisma";
import {
  listCompanies,
  getCompanyById,
  getCompanyCounts,
  getCompanyUsers,
  getCompanyClients,
  getCompanyProjects,
  getCompanyActivities,
} from "@/features/companies/services/company.service";

const mockedPrisma = prisma as unknown as MockPrisma;

const COMPANY_A = "company-a";

beforeEach(() => {
  vi.clearAllMocks();
  mockedPrisma.company.findMany.mockResolvedValue([]);
  mockedPrisma.company.count.mockResolvedValue(0);
  mockedPrisma.company.findUnique.mockResolvedValue(null);
  mockedPrisma.user.count.mockResolvedValue(0);
  mockedPrisma.user.findMany.mockResolvedValue([]);
  mockedPrisma.project.count.mockResolvedValue(0);
  mockedPrisma.project.findMany.mockResolvedValue([]);
  mockedPrisma.client.count.mockResolvedValue(0);
  mockedPrisma.client.findMany.mockResolvedValue([]);
  mockedPrisma.activity.findMany.mockResolvedValue([]);
});

describe("listCompanies", () => {
  it("1. excludes archived rows by default", async () => {
    await listCompanies({});
    const [{ where }] = mockedPrisma.company.findMany.mock.calls[0];
    expect(where.deletedAt).toBeNull();
  });

  it("2. includes only archived rows when status=archived", async () => {
    await listCompanies({ status: "archived" });
    const [{ where }] = mockedPrisma.company.findMany.mock.calls[0];
    expect(where.deletedAt).toEqual({ not: null });
  });

  it("3. applies a case-insensitive OR filter across name/slug when q is set", async () => {
    await listCompanies({ q: "acme" });
    const [{ where }] = mockedPrisma.company.findMany.mock.calls[0];
    expect(where.OR).toEqual([
      { name: { contains: "acme", mode: "insensitive" } },
      { slug: { contains: "acme", mode: "insensitive" } },
    ]);
  });

  it("4. returns companies, totalCount, page, and pageSize using the same where for both queries", async () => {
    mockedPrisma.company.findMany.mockResolvedValue([{ id: "c-1" }]);
    mockedPrisma.company.count.mockResolvedValue(1);

    const result = await listCompanies({ page: "3" });

    expect(result).toEqual({ companies: [{ id: "c-1" }], totalCount: 1, page: 3, pageSize: 10 });
    const [findManyArgs] = mockedPrisma.company.findMany.mock.calls[0];
    const [countArgs] = mockedPrisma.company.count.mock.calls[0];
    expect(findManyArgs.where).toEqual(countArgs.where);
    expect(findManyArgs.skip).toBe(20);
  });
});

describe("getCompanyById", () => {
  it("1. queries by id, including the brand profile relation, and returns whatever Prisma resolves", async () => {
    mockedPrisma.company.findUnique.mockResolvedValue({ id: "c-1", name: "Acme" });
    const result = await getCompanyById("c-1");
    expect(mockedPrisma.company.findUnique).toHaveBeenCalledWith({ where: { id: "c-1" }, include: { brandProfile: true } });
    expect(result).toEqual({ id: "c-1", name: "Acme" });
  });
});

describe("getCompanyCounts", () => {
  it("1. scopes every count query by companyId", async () => {
    await getCompanyCounts(COMPANY_A);
    for (const call of [
      ...mockedPrisma.user.count.mock.calls,
      ...mockedPrisma.project.count.mock.calls,
      ...mockedPrisma.client.count.mock.calls,
    ]) {
      expect(call[0].where.companyId).toBe(COMPANY_A);
    }
  });

  it("2. active-user count filters status ACTIVE and deletedAt null", async () => {
    await getCompanyCounts(COMPANY_A);
    const activeUsersCall = mockedPrisma.user.count.mock.calls[0][0];
    expect(activeUsersCall.where).toEqual({ companyId: COMPANY_A, status: "ACTIVE", deletedAt: null });
  });

  it("3. total-user count filters only deletedAt null (no status filter)", async () => {
    await getCompanyCounts(COMPANY_A);
    const totalUsersCall = mockedPrisma.user.count.mock.calls[1][0];
    expect(totalUsersCall.where).toEqual({ companyId: COMPANY_A, deletedAt: null });
  });

  it("4. returns all six counts in the documented shape", async () => {
    mockedPrisma.user.count.mockResolvedValueOnce(3).mockResolvedValueOnce(5);
    mockedPrisma.project.count.mockResolvedValueOnce(2).mockResolvedValueOnce(4);
    mockedPrisma.client.count.mockResolvedValueOnce(1).mockResolvedValueOnce(6);

    const result = await getCompanyCounts(COMPANY_A);

    expect(result).toEqual({
      activeUsers: 3,
      activeProjects: 2,
      activeClients: 1,
      totalUsers: 5,
      totalProjects: 4,
      totalClients: 6,
    });
  });
});

describe("getCompanyUsers / getCompanyClients / getCompanyProjects", () => {
  it("1. getCompanyUsers scopes by companyId, excludes archived, orders newest-first, caps at 5", async () => {
    await getCompanyUsers(COMPANY_A);
    const [args] = mockedPrisma.user.findMany.mock.calls[0];
    expect(args).toEqual({
      where: { companyId: COMPANY_A, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
  });

  it("2. getCompanyClients scopes by companyId, excludes archived, orders newest-first, caps at 5", async () => {
    await getCompanyClients(COMPANY_A);
    const [args] = mockedPrisma.client.findMany.mock.calls[0];
    expect(args).toEqual({
      where: { companyId: COMPANY_A, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
  });

  it("3. getCompanyProjects scopes by companyId, excludes archived, orders newest-first, caps at 5", async () => {
    await getCompanyProjects(COMPANY_A);
    const [args] = mockedPrisma.project.findMany.mock.calls[0];
    expect(args).toEqual({
      where: { companyId: COMPANY_A, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
  });
});

describe("getCompanyActivities (Phase 28)", () => {
  it("1. scopes by companyId AND action startsWith 'company.' — not a flat companyId filter", async () => {
    // Activity.companyId is the tenant-wide scoping field set on nearly every
    // activity row app-wide, not a "belongs to this Company record" FK — a
    // flat { companyId } filter would return the whole tenant's activity feed,
    // not this Company's own history. The action-prefix filter is what makes
    // this genuinely scoped to the Company record itself.
    await getCompanyActivities(COMPANY_A);
    const [args] = mockedPrisma.activity.findMany.mock.calls[0];
    expect(args.where).toEqual({ companyId: COMPANY_A, action: { startsWith: "company." } });
  });

  it("2. orders newest-first and caps at 20", async () => {
    await getCompanyActivities(COMPANY_A);
    const [args] = mockedPrisma.activity.findMany.mock.calls[0];
    expect(args.orderBy).toEqual({ createdAt: "desc" });
    expect(args.take).toBe(20);
  });

  it("3. includes the actor's first and last name", async () => {
    await getCompanyActivities(COMPANY_A);
    const [args] = mockedPrisma.activity.findMany.mock.calls[0];
    expect(args.include).toEqual({ actor: { select: { firstName: true, lastName: true } } });
  });

  it("4. returns whatever Prisma resolves", async () => {
    const activities = [{ id: "act-1", action: "company.archived" }];
    mockedPrisma.activity.findMany.mockResolvedValue(activities);
    const result = await getCompanyActivities(COMPANY_A);
    expect(result).toBe(activities);
  });
});
