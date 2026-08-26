import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));

type MockPrisma = {
  sEOProject: { findUnique: ReturnType<typeof vi.fn> };
  keyword: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  keywordCluster: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
};

function createMockPrisma(): MockPrisma {
  return {
    sEOProject: { findUnique: vi.fn() },
    keyword: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    keywordCluster: { findFirst: vi.fn(), create: vi.fn() },
  };
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { requireUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/prisma";
import {
  createKeyword,
  updateKeyword,
  archiveKeyword,
  restoreKeyword,
  bulkArchiveKeywords,
  bulkRestoreKeywords,
  bulkDeleteKeywords,
  importKeywordsCsv,
} from "@/features/seo/actions/keyword.actions";
import type { KeywordFormInput } from "@/features/seo/schemas/keyword.schema";

const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedLogActivity = logActivity as unknown as ReturnType<typeof vi.fn>;
const mockedPrisma = prisma as unknown as MockPrisma;

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";

const MANAGER = { id: "user-manager", role: "MANAGER", companyId: COMPANY_A };
const EMPLOYEE = { id: "user-employee", role: "EMPLOYEE", companyId: COMPANY_A };

const SEO_PROJECT = { id: "seo-1", companyId: COMPANY_A };

const VALID_KEYWORD_INPUT: KeywordFormInput = {
  term: "emergency plumber",
  clusterId: "",
  ownerId: "",
  searchVolume: "",
  difficulty: "",
  currentRank: "",
  targetUrl: "",
  intent: "",
  priority: "MEDIUM",
  status: "NOT_STARTED",
};

function makeKeywordWithProject(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "kw-1",
    term: "emergency plumber",
    seoProject: { id: "seo-1", companyId: COMPANY_A },
    ...overrides,
  };
}

function makeCsvFormData(csvText: string, fileName = "keywords.csv") {
  const formData = new FormData();
  formData.set("file", new File([csvText], fileName, { type: "text/csv" }));
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequireUser.mockResolvedValue(MANAGER);
  mockedPrisma.sEOProject.findUnique.mockResolvedValue(SEO_PROJECT);
  mockedPrisma.keyword.findUnique.mockResolvedValue(null);
  mockedPrisma.keyword.findMany.mockResolvedValue([]);
  mockedPrisma.keyword.create.mockResolvedValue({ id: "kw-1", term: "emergency plumber" });
  mockedPrisma.keyword.update.mockResolvedValue({ id: "kw-1", term: "emergency plumber" });
  mockedPrisma.keyword.updateMany.mockResolvedValue({ count: 0 });
  mockedPrisma.keyword.deleteMany.mockResolvedValue({ count: 0 });
  mockedPrisma.keywordCluster.findFirst.mockResolvedValue(null);
  mockedPrisma.keywordCluster.create.mockResolvedValue({ id: "cluster-1", name: "Local SEO" });
});

describe("createKeyword", () => {
  it("1. rejects an EMPLOYEE — below the manageSeoProjects (MANAGER) minimum", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await createKeyword("seo-1", VALID_KEYWORD_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/permission/i);
    expect(mockedPrisma.keyword.create).not.toHaveBeenCalled();
  });

  it("2. rejects a missing/cross-company SEO project (tenant isolation)", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, companyId: COMPANY_B });
    const result = await createKeyword("seo-1", VALID_KEYWORD_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("SEO project not found.");
    expect(mockedPrisma.keyword.create).not.toHaveBeenCalled();
  });

  it("3. rejects invalid input (blank term)", async () => {
    const result = await createKeyword("seo-1", { ...VALID_KEYWORD_INPUT, term: "" });
    expect(result.success).toBe(false);
    expect(mockedPrisma.keyword.create).not.toHaveBeenCalled();
  });

  it("4. rejects a duplicate term within the same SEO project, checked via the compound key", async () => {
    mockedPrisma.keyword.findUnique.mockResolvedValue(makeKeywordWithProject({ term: "emergency plumber" }));
    const result = await createKeyword("seo-1", VALID_KEYWORD_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/already tracked/i);
    expect(mockedPrisma.keyword.findUnique).toHaveBeenCalledWith({
      where: { seoProjectId_term: { seoProjectId: "seo-1", term: "emergency plumber" } },
    });
    expect(mockedPrisma.keyword.create).not.toHaveBeenCalled();
  });

  it("5. creates the keyword with nullable fields correctly normalized from blank form input", async () => {
    await createKeyword("seo-1", VALID_KEYWORD_INPUT);
    expect(mockedPrisma.keyword.create).toHaveBeenCalledWith({
      data: {
        seoProjectId: "seo-1",
        clusterId: null,
        ownerId: null,
        term: "emergency plumber",
        searchVolume: null,
        difficulty: null,
        currentRank: null,
        targetUrl: null,
        intent: null,
        priority: "MEDIUM",
        status: "NOT_STARTED",
      },
    });
  });

  it("6. creates the keyword with populated optional fields converted to numbers", async () => {
    await createKeyword("seo-1", {
      ...VALID_KEYWORD_INPUT,
      clusterId: "cluster-9",
      searchVolume: "1200",
      difficulty: "45",
      currentRank: "3",
      targetUrl: "https://example.test/page",
      intent: "TRANSACTIONAL",
    });
    const [{ data }] = mockedPrisma.keyword.create.mock.calls[0];
    expect(data.clusterId).toBe("cluster-9");
    expect(data.searchVolume).toBe(1200);
    expect(data.difficulty).toBe(45);
    expect(data.currentRank).toBe(3);
    expect(data.targetUrl).toBe("https://example.test/page");
    expect(data.intent).toBe("TRANSACTIONAL");
  });

  it("7. logs keyword.created with the actor/company/seoProject/keyword", async () => {
    mockedPrisma.keyword.create.mockResolvedValue({ id: "new-kw-1", term: "emergency plumber" });
    await createKeyword("seo-1", VALID_KEYWORD_INPUT);
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "keyword.created",
      companyId: COMPANY_A,
      seoProjectId: "seo-1",
      metadata: { keywordId: "new-kw-1", term: "emergency plumber" },
    });
  });

  it("8. returns the new keyword's id", async () => {
    mockedPrisma.keyword.create.mockResolvedValue({ id: "new-kw-1", term: "emergency plumber" });
    const result = await createKeyword("seo-1", VALID_KEYWORD_INPUT);
    expect(result).toEqual({ success: true, data: { id: "new-kw-1" } });
  });
});

describe("updateKeyword", () => {
  beforeEach(() => {
    mockedPrisma.keyword.findUnique.mockResolvedValue(makeKeywordWithProject());
  });

  it("1. rejects an EMPLOYEE", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await updateKeyword("kw-1", VALID_KEYWORD_INPUT);
    expect(result.success).toBe(false);
    expect(mockedPrisma.keyword.update).not.toHaveBeenCalled();
  });

  it("2. returns 'Keyword not found.' for a missing keyword", async () => {
    mockedPrisma.keyword.findUnique.mockResolvedValue(null);
    const result = await updateKeyword("missing", VALID_KEYWORD_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Keyword not found.");
    expect(mockedPrisma.keyword.update).not.toHaveBeenCalled();
  });

  it("3. returns 'Keyword not found.' for a keyword whose SEO project belongs to a different company (tenant isolation)", async () => {
    mockedPrisma.keyword.findUnique.mockResolvedValue(
      makeKeywordWithProject({ seoProject: { id: "seo-1", companyId: COMPANY_B } })
    );
    const result = await updateKeyword("kw-1", VALID_KEYWORD_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Keyword not found.");
    expect(mockedPrisma.keyword.update).not.toHaveBeenCalled();
  });

  it("4. rejects invalid input", async () => {
    const result = await updateKeyword("kw-1", { ...VALID_KEYWORD_INPUT, term: "" });
    expect(result.success).toBe(false);
    expect(mockedPrisma.keyword.update).not.toHaveBeenCalled();
  });

  it("5. updates with the normalized parsed data", async () => {
    await updateKeyword("kw-1", { ...VALID_KEYWORD_INPUT, term: "updated term", priority: "URGENT" });
    expect(mockedPrisma.keyword.update).toHaveBeenCalledWith({
      where: { id: "kw-1" },
      data: {
        clusterId: null,
        ownerId: null,
        term: "updated term",
        searchVolume: null,
        difficulty: null,
        currentRank: null,
        targetUrl: null,
        intent: null,
        priority: "URGENT",
        status: "NOT_STARTED",
      },
    });
  });

  it("6. logs keyword.updated scoped to the keyword's own seoProject", async () => {
    await updateKeyword("kw-1", VALID_KEYWORD_INPUT);
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "keyword.updated",
      companyId: COMPANY_A,
      seoProjectId: "seo-1",
      metadata: { keywordId: "kw-1", term: "emergency plumber" },
    });
  });

  it("7. returns the keyword's id", async () => {
    const result = await updateKeyword("kw-1", VALID_KEYWORD_INPUT);
    expect(result).toEqual({ success: true, data: { id: "kw-1" } });
  });
});

describe("archiveKeyword", () => {
  beforeEach(() => {
    mockedPrisma.keyword.findUnique.mockResolvedValue(makeKeywordWithProject());
  });

  it("1. rejects an EMPLOYEE", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await archiveKeyword("kw-1");
    expect(result.success).toBe(false);
    expect(mockedPrisma.keyword.update).not.toHaveBeenCalled();
  });

  it("2. returns 'Keyword not found.' for a missing/cross-company keyword (tenant isolation)", async () => {
    mockedPrisma.keyword.findUnique.mockResolvedValue(
      makeKeywordWithProject({ seoProject: { id: "seo-1", companyId: COMPANY_B } })
    );
    const result = await archiveKeyword("kw-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Keyword not found.");
    expect(mockedPrisma.keyword.update).not.toHaveBeenCalled();
  });

  it("3. sets deletedAt to a Date instance, nothing else", async () => {
    await archiveKeyword("kw-1");
    const [{ data }] = mockedPrisma.keyword.update.mock.calls[0];
    expect(Object.keys(data)).toEqual(["deletedAt"]);
    expect(data.deletedAt).toBeInstanceOf(Date);
  });

  it("4. logs keyword.archived", async () => {
    await archiveKeyword("kw-1");
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "keyword.archived",
      companyId: COMPANY_A,
      seoProjectId: "seo-1",
      metadata: { keywordId: "kw-1" },
    });
  });

  it("5. returns success", async () => {
    const result = await archiveKeyword("kw-1");
    expect(result.success).toBe(true);
  });
});

describe("restoreKeyword", () => {
  beforeEach(() => {
    mockedPrisma.keyword.findUnique.mockResolvedValue(makeKeywordWithProject());
  });

  it("1. rejects an EMPLOYEE", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await restoreKeyword("kw-1");
    expect(result.success).toBe(false);
    expect(mockedPrisma.keyword.update).not.toHaveBeenCalled();
  });

  it("2. returns 'Keyword not found.' for a missing/cross-company keyword (tenant isolation)", async () => {
    mockedPrisma.keyword.findUnique.mockResolvedValue(
      makeKeywordWithProject({ seoProject: { id: "seo-1", companyId: COMPANY_B } })
    );
    const result = await restoreKeyword("kw-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Keyword not found.");
    expect(mockedPrisma.keyword.update).not.toHaveBeenCalled();
  });

  it("3. sets deletedAt to null", async () => {
    await restoreKeyword("kw-1");
    expect(mockedPrisma.keyword.update).toHaveBeenCalledWith({
      where: { id: "kw-1" },
      data: { deletedAt: null },
    });
  });

  it("4. logs keyword.restored", async () => {
    await restoreKeyword("kw-1");
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "keyword.restored",
      companyId: COMPANY_A,
      seoProjectId: "seo-1",
      metadata: { keywordId: "kw-1" },
    });
  });

  it("5. returns success", async () => {
    const result = await restoreKeyword("kw-1");
    expect(result.success).toBe(true);
  });
});

describe("bulkArchiveKeywords — tenant-scoped via the shared getOwnedKeywordIds helper", () => {
  it("1. rejects an EMPLOYEE before any DB call", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await bulkArchiveKeywords("seo-1", ["kw-1"]);
    expect(result.success).toBe(false);
    expect(mockedPrisma.sEOProject.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.keyword.updateMany).not.toHaveBeenCalled();
  });

  it("2. returns 'No matching keywords found.' when the SEO project belongs to a different company (tenant isolation)", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, companyId: COMPANY_B });
    const result = await bulkArchiveKeywords("seo-1", ["kw-1"]);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("No matching keywords found.");
    expect(mockedPrisma.keyword.updateMany).not.toHaveBeenCalled();
  });

  it("3. only mutates ids that getOwnedKeywordIds actually found — an id from another project/company is silently dropped, not mutated", async () => {
    // keyword.findMany's own where clause (id in ids AND seoProjectId) is what
    // filters out "foreign-1" here — asserting on updateMany's resulting ids
    // proves the end-to-end behavior, not just that the helper was called.
    mockedPrisma.keyword.findMany.mockResolvedValue([{ id: "kw-1" }, { id: "kw-2" }]);
    mockedPrisma.keyword.updateMany.mockResolvedValue({ count: 2 });

    await bulkArchiveKeywords("seo-1", ["kw-1", "kw-2", "foreign-1"]);

    expect(mockedPrisma.keyword.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["kw-1", "kw-2", "foreign-1"] }, seoProjectId: "seo-1" },
      select: { id: true },
    });
    expect(mockedPrisma.keyword.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["kw-1", "kw-2"] } },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it("4. returns 'No matching keywords found.' and never calls updateMany when none of the ids belong to this project", async () => {
    mockedPrisma.keyword.findMany.mockResolvedValue([]);
    const result = await bulkArchiveKeywords("seo-1", ["foreign-1", "foreign-2"]);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("No matching keywords found.");
    expect(mockedPrisma.keyword.updateMany).not.toHaveBeenCalled();
  });

  it("5. returns the updated count and logs keyword.bulk_archived", async () => {
    mockedPrisma.keyword.findMany.mockResolvedValue([{ id: "kw-1" }]);
    mockedPrisma.keyword.updateMany.mockResolvedValue({ count: 1 });

    const result = await bulkArchiveKeywords("seo-1", ["kw-1"]);

    expect(result).toEqual({ success: true, data: { count: 1 } });
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "keyword.bulk_archived",
      companyId: COMPANY_A,
      seoProjectId: "seo-1",
      metadata: { count: 1 },
    });
  });
});

describe("bulkRestoreKeywords — tenant-scoped via the shared getOwnedKeywordIds helper", () => {
  it("1. rejects an EMPLOYEE before any DB call", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await bulkRestoreKeywords("seo-1", ["kw-1"]);
    expect(result.success).toBe(false);
    expect(mockedPrisma.keyword.updateMany).not.toHaveBeenCalled();
  });

  it("2. returns 'No matching keywords found.' when the SEO project belongs to a different company (tenant isolation)", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, companyId: COMPANY_B });
    const result = await bulkRestoreKeywords("seo-1", ["kw-1"]);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("No matching keywords found.");
    expect(mockedPrisma.keyword.updateMany).not.toHaveBeenCalled();
  });

  it("3. only mutates ids that getOwnedKeywordIds actually found", async () => {
    mockedPrisma.keyword.findMany.mockResolvedValue([{ id: "kw-1" }]);
    mockedPrisma.keyword.updateMany.mockResolvedValue({ count: 1 });

    await bulkRestoreKeywords("seo-1", ["kw-1", "foreign-1"]);

    expect(mockedPrisma.keyword.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["kw-1"] } },
      data: { deletedAt: null },
    });
  });

  it("4. returns the restored count and logs keyword.bulk_restored", async () => {
    mockedPrisma.keyword.findMany.mockResolvedValue([{ id: "kw-1" }, { id: "kw-2" }]);
    mockedPrisma.keyword.updateMany.mockResolvedValue({ count: 2 });

    const result = await bulkRestoreKeywords("seo-1", ["kw-1", "kw-2"]);

    expect(result).toEqual({ success: true, data: { count: 2 } });
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "keyword.bulk_restored",
      companyId: COMPANY_A,
      seoProjectId: "seo-1",
      metadata: { count: 2 },
    });
  });
});

describe("bulkDeleteKeywords — hard-delete safety", () => {
  // Unlike the bulk archive/restore actions, this one does NOT call the shared
  // getOwnedKeywordIds helper — it verifies the SEO project belongs to the
  // actor's company once, then relies on deleteMany's own `where` clause
  // (seoProjectId + deletedAt: {not: null}) to simultaneously enforce both
  // tenant scoping and the archived-only safety gate in a single query. Any
  // id for a keyword in a different project/company, or one that isn't
  // archived, simply fails to match that where clause and is left untouched.

  it("1. rejects an EMPLOYEE before any DB call", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await bulkDeleteKeywords("seo-1", ["kw-1"]);
    expect(result.success).toBe(false);
    expect(mockedPrisma.sEOProject.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.keyword.deleteMany).not.toHaveBeenCalled();
  });

  it("2. rejects a missing/cross-company SEO project — the tenant gate for this action (deleteMany never runs)", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, companyId: COMPANY_B });
    const result = await bulkDeleteKeywords("seo-1", ["kw-1"]);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("SEO project not found.");
    expect(mockedPrisma.keyword.deleteMany).not.toHaveBeenCalled();
  });

  it("3. the delete criteria requires deletedAt: {not: null} — an active (non-archived) keyword id can never match, however it's passed in", async () => {
    await bulkDeleteKeywords("seo-1", ["active-kw-1", "archived-kw-1"]);
    const [{ where }] = mockedPrisma.keyword.deleteMany.mock.calls[0];
    expect(where.deletedAt).toEqual({ not: null });
  });

  it("4. the delete criteria is scoped to this verified seoProjectId — an id belonging to another project/company can never match", async () => {
    await bulkDeleteKeywords("seo-1", ["kw-1", "foreign-1"]);
    const [{ where }] = mockedPrisma.keyword.deleteMany.mock.calls[0];
    expect(where.seoProjectId).toBe("seo-1");
    expect(where.id).toEqual({ in: ["kw-1", "foreign-1"] });
  });

  it("5. issues exactly the documented delete criteria — no broader condition than id/seoProjectId/archived-only", async () => {
    await bulkDeleteKeywords("seo-1", ["kw-1"]);
    expect(mockedPrisma.keyword.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["kw-1"] }, seoProjectId: "seo-1", deletedAt: { not: null } },
    });
  });

  it("6. returns the deleted count and logs keyword.bulk_deleted", async () => {
    mockedPrisma.keyword.deleteMany.mockResolvedValue({ count: 1 });
    const result = await bulkDeleteKeywords("seo-1", ["kw-1"]);

    expect(result).toEqual({ success: true, data: { count: 1 } });
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "keyword.bulk_deleted",
      companyId: COMPANY_A,
      seoProjectId: "seo-1",
      metadata: { count: 1 },
    });
  });

  it("7. reports count: 0 without error when nothing matched (e.g. every id was still active)", async () => {
    mockedPrisma.keyword.deleteMany.mockResolvedValue({ count: 0 });
    const result = await bulkDeleteKeywords("seo-1", ["active-kw-1"]);
    expect(result).toEqual({ success: true, data: { count: 0 } });
  });
});

describe("importKeywordsCsv", () => {
  it("1. rejects an EMPLOYEE", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await importKeywordsCsv("seo-1", makeCsvFormData("term\nfoo"));
    expect(result.success).toBe(false);
    expect(mockedPrisma.keyword.create).not.toHaveBeenCalled();
  });

  it("2. rejects a missing/cross-company SEO project (tenant isolation)", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, companyId: COMPANY_B });
    const result = await importKeywordsCsv("seo-1", makeCsvFormData("term\nfoo"));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("SEO project not found.");
  });

  it("3. rejects when no file is provided", async () => {
    const result = await importKeywordsCsv("seo-1", new FormData());
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Choose a CSV file first.");
  });

  it("4. rejects an empty file", async () => {
    const result = await importKeywordsCsv("seo-1", makeCsvFormData(""));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Choose a CSV file first.");
  });

  it("5. rejects a CSV with a header but no data rows", async () => {
    const formData = new FormData();
    formData.set("file", new File(["term,searchVolume"], "keywords.csv", { type: "text/csv" }));
    const result = await importKeywordsCsv("seo-1", formData);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("The CSV file has no data rows.");
  });

  it("6. creates a keyword from a fully-populated valid row, converting numeric fields", async () => {
    const csv = "term,searchVolume,difficulty,currentRank,targetUrl,cluster,intent,priority,status\nemergency plumber,1200,45,3,https://example.test,,TRANSACTIONAL,HIGH,IN_PROGRESS";
    const result = await importKeywordsCsv("seo-1", makeCsvFormData(csv));

    expect(result).toEqual({ success: true, data: { created: 1, errors: [] } });
    expect(mockedPrisma.keyword.create).toHaveBeenCalledWith({
      data: {
        seoProjectId: "seo-1",
        clusterId: null,
        term: "emergency plumber",
        searchVolume: 1200,
        difficulty: 45,
        currentRank: 3,
        targetUrl: "https://example.test",
        intent: "TRANSACTIONAL",
        priority: "HIGH",
        status: "IN_PROGRESS",
      },
    });
  });

  it("7. applies the schema's default priority (MEDIUM) and status (NOT_STARTED) for a minimal row", async () => {
    const csv = "term\nwater heater repair";
    await importKeywordsCsv("seo-1", makeCsvFormData(csv));
    const [{ data }] = mockedPrisma.keyword.create.mock.calls[0];
    expect(data.priority).toBe("MEDIUM");
    expect(data.status).toBe("NOT_STARTED");
    expect(data.clusterId).toBeNull();
  });

  it("8. accumulates a validation error for a row with a blank term, using the 1-indexed + header row number, and creates nothing for it", async () => {
    // A wholly blank line is stripped by parseCsv before it ever becomes a
    // row, so this uses a row with content in a later column but an empty
    // term field to actually reach keywordImportRowSchema's validation.
    const csv = "term,searchVolume\n,999\nvalid term,";
    const result = await importKeywordsCsv("seo-1", makeCsvFormData(csv));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toBe(1);
      expect(result.data.errors).toHaveLength(1);
      expect(result.data.errors[0].row).toBe(2);
    }
    expect(mockedPrisma.keyword.create).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.keyword.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ term: "valid term" }) })
    );
  });

  it("9. accumulates an 'already exists' error for a duplicate term and does not create it", async () => {
    mockedPrisma.keyword.findUnique.mockImplementation(({ where }: { where: { seoProjectId_term: { term: string } } }) =>
      where.seoProjectId_term.term === "existing term" ? Promise.resolve(makeKeywordWithProject()) : Promise.resolve(null)
    );

    const csv = "term\nexisting term";
    const result = await importKeywordsCsv("seo-1", makeCsvFormData(csv));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toBe(0);
      expect(result.data.errors).toEqual([{ row: 2, message: '"existing term" already exists' }]);
    }
    expect(mockedPrisma.keyword.create).not.toHaveBeenCalled();
  });

  it("10. resolves an existing cluster case-insensitively and reuses its id without creating a new one", async () => {
    mockedPrisma.keywordCluster.findFirst.mockResolvedValue({ id: "existing-cluster-1", name: "Local SEO" });

    const csv = "term,cluster\nemergency plumber,local seo";
    await importKeywordsCsv("seo-1", makeCsvFormData(csv));

    expect(mockedPrisma.keywordCluster.findFirst).toHaveBeenCalledWith({
      where: { seoProjectId: "seo-1", name: { equals: "local seo", mode: "insensitive" } },
    });
    expect(mockedPrisma.keywordCluster.create).not.toHaveBeenCalled();
    const [{ data }] = mockedPrisma.keyword.create.mock.calls[0];
    expect(data.clusterId).toBe("existing-cluster-1");
  });

  it("11. creates a new cluster when no existing one matches, and uses its id", async () => {
    mockedPrisma.keywordCluster.findFirst.mockResolvedValue(null);
    mockedPrisma.keywordCluster.create.mockResolvedValue({ id: "new-cluster-1", name: "Local SEO" });

    const csv = "term,cluster\nemergency plumber,Local SEO";
    await importKeywordsCsv("seo-1", makeCsvFormData(csv));

    expect(mockedPrisma.keywordCluster.create).toHaveBeenCalledWith({
      data: { seoProjectId: "seo-1", name: "Local SEO" },
    });
    const [{ data }] = mockedPrisma.keyword.create.mock.calls[0];
    expect(data.clusterId).toBe("new-cluster-1");
  });

  it("12. caches cluster resolution across rows sharing the same cluster name — only one lookup for two rows", async () => {
    const csv = "term,cluster\nemergency plumber,Local SEO\nwater heater repair,Local SEO";
    await importKeywordsCsv("seo-1", makeCsvFormData(csv));

    expect(mockedPrisma.keywordCluster.findFirst).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.keywordCluster.create).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.keyword.create).toHaveBeenCalledTimes(2);
  });

  it("13. a row with no cluster value gets clusterId: null and never calls keywordCluster at all", async () => {
    const csv = "term\nemergency plumber";
    await importKeywordsCsv("seo-1", makeCsvFormData(csv));

    expect(mockedPrisma.keywordCluster.findFirst).not.toHaveBeenCalled();
    expect(mockedPrisma.keywordCluster.create).not.toHaveBeenCalled();
    const [{ data }] = mockedPrisma.keyword.create.mock.calls[0];
    expect(data.clusterId).toBeNull();
  });

  it("14. catches a row-level creation failure and reports it as an error without aborting the rest of the import", async () => {
    mockedPrisma.keyword.create
      .mockRejectedValueOnce(new Error("simulated DB failure"))
      .mockResolvedValueOnce({ id: "kw-2", term: "second term" });

    const csv = "term\nfirst term\nsecond term";
    const result = await importKeywordsCsv("seo-1", makeCsvFormData(csv));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toBe(1);
      expect(result.data.errors).toEqual([{ row: 2, message: "Failed to import this row" }]);
    }
    expect(mockedPrisma.keyword.create).toHaveBeenCalledTimes(2);
  });

  it("15. logs keyword.csv_imported with the created count and error count", async () => {
    const csv = "term,searchVolume\n,999\nvalid term,";
    await importKeywordsCsv("seo-1", makeCsvFormData(csv));

    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "keyword.csv_imported",
      companyId: COMPANY_A,
      seoProjectId: "seo-1",
      metadata: { created: 1, errorCount: 1 },
    });
  });

  it("16. accumulates a full mixed-outcome import correctly: success, validation error, and duplicate in one file", async () => {
    mockedPrisma.keyword.findUnique.mockImplementation(({ where }: { where: { seoProjectId_term: { term: string } } }) =>
      where.seoProjectId_term.term === "existing term" ? Promise.resolve(makeKeywordWithProject()) : Promise.resolve(null)
    );

    const csv = "term,searchVolume\nnew term,\n,999\nexisting term,";
    const result = await importKeywordsCsv("seo-1", makeCsvFormData(csv));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toBe(1);
      expect(result.data.errors).toEqual([
        { row: 3, message: expect.any(String) },
        { row: 4, message: '"existing term" already exists' },
      ]);
    }
  });
});
