import { beforeEach, describe, expect, it, vi } from "vitest";

type MockPrisma = {
  company: { findMany: ReturnType<typeof vi.fn> };
  user: { findMany: ReturnType<typeof vi.fn> };
  client: { findMany: ReturnType<typeof vi.fn> };
  lead: { findMany: ReturnType<typeof vi.fn> };
  project: { findMany: ReturnType<typeof vi.fn> };
  task: { findMany: ReturnType<typeof vi.fn> };
  file: { findMany: ReturnType<typeof vi.fn> };
  report: { findMany: ReturnType<typeof vi.fn> };
  sEOProject: { findMany: ReturnType<typeof vi.fn> };
  keyword: { findMany: ReturnType<typeof vi.fn> };
  content: { findMany: ReturnType<typeof vi.fn> };
};

function createMockPrisma(): MockPrisma {
  return {
    company: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    client: { findMany: vi.fn().mockResolvedValue([]) },
    lead: { findMany: vi.fn().mockResolvedValue([]) },
    project: { findMany: vi.fn().mockResolvedValue([]) },
    task: { findMany: vi.fn().mockResolvedValue([]) },
    file: { findMany: vi.fn().mockResolvedValue([]) },
    report: { findMany: vi.fn().mockResolvedValue([]) },
    sEOProject: { findMany: vi.fn().mockResolvedValue([]) },
    keyword: { findMany: vi.fn().mockResolvedValue([]) },
    content: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { prisma } from "@/lib/prisma";
import { globalSearch } from "@/features/search/services/search.service";

const mockedPrisma = prisma as unknown as MockPrisma;

const COMPANY_A = "company-a";

const SUPER_ADMIN = { id: "user-1", role: "SUPER_ADMIN" as const, companyId: COMPANY_A };
const ADMIN = { id: "user-2", role: "ADMIN" as const, companyId: COMPANY_A };
const MANAGER = { id: "user-3", role: "MANAGER" as const, companyId: COMPANY_A };
const EMPLOYEE = { id: "user-4", role: "EMPLOYEE" as const, companyId: COMPANY_A };

beforeEach(() => {
  vi.clearAllMocks();
  mockedPrisma.company.findMany.mockResolvedValue([]);
  mockedPrisma.user.findMany.mockResolvedValue([]);
  mockedPrisma.client.findMany.mockResolvedValue([]);
  mockedPrisma.lead.findMany.mockResolvedValue([]);
  mockedPrisma.project.findMany.mockResolvedValue([]);
  mockedPrisma.task.findMany.mockResolvedValue([]);
  mockedPrisma.file.findMany.mockResolvedValue([]);
  mockedPrisma.report.findMany.mockResolvedValue([]);
  mockedPrisma.sEOProject.findMany.mockResolvedValue([]);
  mockedPrisma.keyword.findMany.mockResolvedValue([]);
  mockedPrisma.content.findMany.mockResolvedValue([]);
});

describe("globalSearch — minimum query length", () => {
  it("returns the empty result shape for an empty query with zero Prisma calls", async () => {
    const result = await globalSearch("", MANAGER);

    expect(result).toEqual({
      query: "",
      companies: [],
      users: [],
      clients: [],
      leads: [],
      projects: [],
      tasks: [],
      files: [],
      reports: [],
      seoProjects: [],
      keywords: [],
      content: [],
      canSeeCompanies: false,
      canSeeUsers: false,
    });
    expect(mockedPrisma.company.findMany).not.toHaveBeenCalled();
    expect(mockedPrisma.user.findMany).not.toHaveBeenCalled();
    expect(mockedPrisma.client.findMany).not.toHaveBeenCalled();
    expect(mockedPrisma.lead.findMany).not.toHaveBeenCalled();
    expect(mockedPrisma.project.findMany).not.toHaveBeenCalled();
    expect(mockedPrisma.task.findMany).not.toHaveBeenCalled();
    expect(mockedPrisma.file.findMany).not.toHaveBeenCalled();
    expect(mockedPrisma.report.findMany).not.toHaveBeenCalled();
    expect(mockedPrisma.sEOProject.findMany).not.toHaveBeenCalled();
    expect(mockedPrisma.keyword.findMany).not.toHaveBeenCalled();
    expect(mockedPrisma.content.findMany).not.toHaveBeenCalled();
  });

  it("returns the empty result shape for a 1-character query with zero Prisma calls", async () => {
    const result = await globalSearch("a", MANAGER);

    expect(result.companies).toEqual([]);
    expect(result.query).toBe("a");
    expect(mockedPrisma.client.findMany).not.toHaveBeenCalled();
    expect(mockedPrisma.file.findMany).not.toHaveBeenCalled();
  });

  it("trims whitespace before applying the minimum-length gate, still with zero Prisma calls for a too-short result", async () => {
    const result = await globalSearch("  a  ", MANAGER);

    expect(result.query).toBe("a");
    expect(mockedPrisma.client.findMany).not.toHaveBeenCalled();
  });

  it("proceeds to search for a 2-character query", async () => {
    await globalSearch("ab", MANAGER);

    expect(mockedPrisma.client.findMany).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.lead.findMany).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.project.findMany).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.task.findMany).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.file.findMany).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.report.findMany).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.sEOProject.findMany).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.keyword.findMany).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.content.findMany).toHaveBeenCalledTimes(1);
  });
});

describe("globalSearch — Companies permission gating", () => {
  it("returns no Company results and skips the query for a non-Super-Admin (MANAGER)", async () => {
    const result = await globalSearch("acme", MANAGER);

    expect(result.companies).toEqual([]);
    expect(result.canSeeCompanies).toBe(false);
    expect(mockedPrisma.company.findMany).not.toHaveBeenCalled();
  });

  it("returns no Company results and skips the query for an ADMIN", async () => {
    const result = await globalSearch("acme", ADMIN);

    expect(result.companies).toEqual([]);
    expect(mockedPrisma.company.findMany).not.toHaveBeenCalled();
  });

  it("runs the Company query for a SUPER_ADMIN", async () => {
    mockedPrisma.company.findMany.mockResolvedValue([{ id: "c-1", name: "Acme", slug: "acme" }]);

    const result = await globalSearch("acme", SUPER_ADMIN);

    expect(result.companies).toEqual([{ id: "c-1", name: "Acme", slug: "acme" }]);
    expect(result.canSeeCompanies).toBe(true);
    expect(mockedPrisma.company.findMany).toHaveBeenCalledTimes(1);
  });
});

describe("globalSearch — Users permission gating", () => {
  it("returns no User results and skips the query for an EMPLOYEE", async () => {
    const result = await globalSearch("jane", EMPLOYEE);

    expect(result.users).toEqual([]);
    expect(result.canSeeUsers).toBe(false);
    expect(mockedPrisma.user.findMany).not.toHaveBeenCalled();
  });

  it("returns no User results and skips the query for a MANAGER (below the ADMIN minimum)", async () => {
    const result = await globalSearch("jane", MANAGER);

    expect(result.users).toEqual([]);
    expect(mockedPrisma.user.findMany).not.toHaveBeenCalled();
  });

  it("runs the User query for an ADMIN", async () => {
    mockedPrisma.user.findMany.mockResolvedValue([
      { id: "u-1", firstName: "Jane", lastName: "Doe", email: "jane@acme.test" },
    ]);

    const result = await globalSearch("jane", ADMIN);

    expect(result.users).toEqual([
      { id: "u-1", firstName: "Jane", lastName: "Doe", email: "jane@acme.test" },
    ]);
    expect(result.canSeeUsers).toBe(true);
    expect(mockedPrisma.user.findMany).toHaveBeenCalledTimes(1);
  });

  it("runs the User query for a SUPER_ADMIN", async () => {
    await globalSearch("jane", SUPER_ADMIN);
    expect(mockedPrisma.user.findMany).toHaveBeenCalledTimes(1);
  });
});

describe("globalSearch — tenant isolation", () => {
  const OTHER_COMPANY_ACTOR = { id: "user-9", role: "MANAGER" as const, companyId: "company-b" };

  it("scopes the User query by the actor's own companyId, never a client-supplied one", async () => {
    await globalSearch("jane", ADMIN);
    expect(mockedPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: COMPANY_A }),
      })
    );
  });

  it("scopes the Task query by project.companyId derived from the actor", async () => {
    await globalSearch("fix bug", MANAGER);
    expect(mockedPrisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ project: { companyId: COMPANY_A } }),
      })
    );
  });

  it("scopes the Keyword query by seoProject.companyId derived from the actor", async () => {
    await globalSearch("plumber", MANAGER);
    expect(mockedPrisma.keyword.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ seoProject: { companyId: COMPANY_A } }),
      })
    );
  });

  it("scopes the Content query by seoProject.companyId derived from the actor", async () => {
    await globalSearch("guide", MANAGER);
    expect(mockedPrisma.content.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ seoProject: { companyId: COMPANY_A } }),
      })
    );
  });

  it("uses a different actor's companyId when that actor belongs to a different company", async () => {
    await globalSearch("jane", OTHER_COMPANY_ACTOR);
    expect(mockedPrisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: "company-b" }),
      })
    );
  });
});

describe("globalSearch — File 8-branch ownership coverage", () => {
  it("constructs the complete 8-branch OR array covering every reachable File relationship", async () => {
    await globalSearch("report", MANAGER);

    const [{ where }] = mockedPrisma.file.findMany.mock.calls[0];
    expect(where.OR).toEqual([
      { companyId: COMPANY_A },
      { client: { companyId: COMPANY_A } },
      { project: { companyId: COMPANY_A } },
      { task: { project: { companyId: COMPANY_A } } },
      { lead: { companyId: COMPANY_A } },
      { seoProject: { companyId: COMPANY_A } },
      { content: { seoProject: { companyId: COMPANY_A } } },
      { user: { companyId: COMPANY_A } },
    ]);
  });

  it("filters Files by deletedAt: null", async () => {
    await globalSearch("report", MANAGER);
    const [{ where }] = mockedPrisma.file.findMany.mock.calls[0];
    expect(where.deletedAt).toBeNull();
  });

  it("matches Files by fileName, case-insensitively", async () => {
    await globalSearch("report", MANAGER);
    const [{ where }] = mockedPrisma.file.findMany.mock.calls[0];
    expect(where.fileName).toEqual({ contains: "report", mode: "insensitive" });
  });

  it("caps the File query at RESULT_LIMIT (8)", async () => {
    await globalSearch("report", MANAGER);
    const [args] = mockedPrisma.file.findMany.mock.calls[0];
    expect(args.take).toBe(8);
  });
});

describe("globalSearch — result behavior", () => {
  it("returns matching records for a category without fabricating unmatched ones", async () => {
    mockedPrisma.client.findMany.mockResolvedValue([{ id: "cl-1", name: "Acme Plumbing", email: null }]);

    const result = await globalSearch("acme", MANAGER);

    expect(result.clients).toEqual([{ id: "cl-1", name: "Acme Plumbing", email: null }]);
    expect(result.leads).toEqual([]);
    expect(result.projects).toEqual([]);
  });

  it("requests at most RESULT_LIMIT (8) results per category", async () => {
    await globalSearch("acme", MANAGER);

    for (const mockFn of [
      mockedPrisma.client.findMany,
      mockedPrisma.lead.findMany,
      mockedPrisma.project.findMany,
      mockedPrisma.task.findMany,
      mockedPrisma.report.findMany,
      mockedPrisma.sEOProject.findMany,
      mockedPrisma.keyword.findMany,
      mockedPrisma.content.findMany,
    ]) {
      const [args] = mockFn.mock.calls[0];
      expect(args.take).toBe(8);
    }
  });

  it("returns the unchanged 11-category result shape", async () => {
    const result = await globalSearch("acme", MANAGER);

    expect(Object.keys(result).sort()).toEqual(
      [
        "query",
        "companies",
        "users",
        "clients",
        "leads",
        "projects",
        "tasks",
        "files",
        "reports",
        "seoProjects",
        "keywords",
        "content",
        "canSeeCompanies",
        "canSeeUsers",
      ].sort()
    );
  });
});

describe("globalSearch — lifecycle filtering", () => {
  it("filters Clients by deletedAt: null", async () => {
    await globalSearch("acme", MANAGER);
    expect(mockedPrisma.client.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) })
    );
  });

  it("filters Files by deletedAt: null (soft-deleted files never appear in Search)", async () => {
    await globalSearch("report", MANAGER);
    expect(mockedPrisma.file.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) })
    );
  });
});
