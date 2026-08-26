import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));

type MockPrisma = {
  sEOProject: { findUnique: ReturnType<typeof vi.fn> };
  keywordCluster: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

function createMockPrisma(): MockPrisma {
  return {
    sEOProject: { findUnique: vi.fn() },
    keywordCluster: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  };
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { requireUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/prisma";
import {
  createCluster,
  updateCluster,
  archiveCluster,
  restoreCluster,
} from "@/features/seo/actions/keyword-cluster.actions";
import type { KeywordClusterInput } from "@/features/seo/schemas/keyword-cluster.schema";

const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedLogActivity = logActivity as unknown as ReturnType<typeof vi.fn>;
const mockedPrisma = prisma as unknown as MockPrisma;

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";
const MANAGER = { id: "user-1", role: "MANAGER", companyId: COMPANY_A };
const EMPLOYEE = { id: "user-2", role: "EMPLOYEE", companyId: COMPANY_A };

const SEO_PROJECT = { id: "seo-1", companyId: COMPANY_A };

const VALID_INPUT: KeywordClusterInput = { name: "Local SEO", description: "Local intent keywords" };

function makeClusterWithProject(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "cluster-1",
    name: "Local SEO",
    seoProject: { id: "seo-1", companyId: COMPANY_A },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequireUser.mockResolvedValue(MANAGER);
  mockedPrisma.sEOProject.findUnique.mockResolvedValue(SEO_PROJECT);
  mockedPrisma.keywordCluster.findUnique.mockResolvedValue(makeClusterWithProject());
  mockedPrisma.keywordCluster.create.mockResolvedValue({ id: "cluster-1", name: "Local SEO" });
  mockedPrisma.keywordCluster.update.mockResolvedValue({ id: "cluster-1", name: "Local SEO" });
});

describe("createCluster", () => {
  it("1. rejects an EMPLOYEE — below the manageSeoProjects (MANAGER) minimum", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await createCluster("seo-1", VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/permission/i);
    expect(mockedPrisma.keywordCluster.create).not.toHaveBeenCalled();
  });

  it("2. succeeds for a MANAGER", async () => {
    const result = await createCluster("seo-1", VALID_INPUT);
    expect(result.success).toBe(true);
  });

  it("3. rejects a missing/cross-company SEO project (tenant isolation)", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, companyId: COMPANY_B });
    const result = await createCluster("seo-1", VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("SEO project not found.");
    expect(mockedPrisma.keywordCluster.create).not.toHaveBeenCalled();
  });

  it("4. rejects invalid input (name too short)", async () => {
    const result = await createCluster("seo-1", { name: "A" });
    expect(result.success).toBe(false);
    expect(mockedPrisma.keywordCluster.create).not.toHaveBeenCalled();
  });

  it("5. creates the cluster scoped to the given seoProjectId with the parsed name/description", async () => {
    await createCluster("seo-1", VALID_INPUT);
    expect(mockedPrisma.keywordCluster.create).toHaveBeenCalledWith({
      data: {
        seoProjectId: "seo-1",
        name: "Local SEO",
        description: "Local intent keywords",
      },
    });
  });

  it("6. logs keyword_cluster.created with the actor/company/seoProject/cluster", async () => {
    mockedPrisma.keywordCluster.create.mockResolvedValue({ id: "new-cluster-1", name: "Local SEO" });
    await createCluster("seo-1", VALID_INPUT);
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "keyword_cluster.created",
      companyId: COMPANY_A,
      seoProjectId: "seo-1",
      metadata: { clusterId: "new-cluster-1", name: "Local SEO" },
    });
  });

  it("7. revalidates both the clusters list and the SEO project page", async () => {
    const { revalidatePath } = await import("next/cache");
    await createCluster("seo-1", VALID_INPUT);
    expect(revalidatePath).toHaveBeenCalledWith("/seo/seo-1/clusters");
    expect(revalidatePath).toHaveBeenCalledWith("/seo/seo-1");
  });

  it("8. returns the new cluster's id", async () => {
    mockedPrisma.keywordCluster.create.mockResolvedValue({ id: "new-cluster-1", name: "Local SEO" });
    const result = await createCluster("seo-1", VALID_INPUT);
    expect(result).toEqual({ success: true, data: { id: "new-cluster-1" } });
  });
});

describe("updateCluster", () => {
  it("1. rejects an EMPLOYEE", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await updateCluster("cluster-1", VALID_INPUT);
    expect(result.success).toBe(false);
    expect(mockedPrisma.keywordCluster.update).not.toHaveBeenCalled();
  });

  it("2. returns 'Keyword cluster not found.' for a missing cluster", async () => {
    mockedPrisma.keywordCluster.findUnique.mockResolvedValue(null);
    const result = await updateCluster("missing", VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Keyword cluster not found.");
    expect(mockedPrisma.keywordCluster.update).not.toHaveBeenCalled();
  });

  it("3. returns 'Keyword cluster not found.' for a cluster whose SEO project belongs to a different company (tenant isolation)", async () => {
    mockedPrisma.keywordCluster.findUnique.mockResolvedValue(
      makeClusterWithProject({ seoProject: { id: "seo-1", companyId: COMPANY_B } })
    );
    const result = await updateCluster("cluster-1", VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Keyword cluster not found.");
    expect(mockedPrisma.keywordCluster.update).not.toHaveBeenCalled();
  });

  it("4. rejects invalid input", async () => {
    const result = await updateCluster("cluster-1", { name: "" });
    expect(result.success).toBe(false);
    expect(mockedPrisma.keywordCluster.update).not.toHaveBeenCalled();
  });

  it("5. updates with only the parsed name/description", async () => {
    await updateCluster("cluster-1", { name: "Updated Name", description: "Updated desc" });
    expect(mockedPrisma.keywordCluster.update).toHaveBeenCalledWith({
      where: { id: "cluster-1" },
      data: { name: "Updated Name", description: "Updated desc" },
    });
  });

  it("6. logs keyword_cluster.updated scoped to the cluster's own seoProject", async () => {
    await updateCluster("cluster-1", VALID_INPUT);
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "keyword_cluster.updated",
      companyId: COMPANY_A,
      seoProjectId: "seo-1",
      metadata: { clusterId: "cluster-1", name: "Local SEO" },
    });
  });

  it("7. revalidates both the clusters list and the cluster detail page", async () => {
    const { revalidatePath } = await import("next/cache");
    await updateCluster("cluster-1", VALID_INPUT);
    expect(revalidatePath).toHaveBeenCalledWith("/seo/seo-1/clusters");
    expect(revalidatePath).toHaveBeenCalledWith("/seo/seo-1/clusters/cluster-1");
  });

  it("8. returns the cluster's id", async () => {
    const result = await updateCluster("cluster-1", VALID_INPUT);
    expect(result).toEqual({ success: true, data: { id: "cluster-1" } });
  });
});

describe("archiveCluster", () => {
  it("1. rejects an EMPLOYEE", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await archiveCluster("cluster-1");
    expect(result.success).toBe(false);
    expect(mockedPrisma.keywordCluster.update).not.toHaveBeenCalled();
  });

  it("2. returns 'Keyword cluster not found.' for a missing/cross-company cluster (tenant isolation)", async () => {
    mockedPrisma.keywordCluster.findUnique.mockResolvedValue(
      makeClusterWithProject({ seoProject: { id: "seo-1", companyId: COMPANY_B } })
    );
    const result = await archiveCluster("cluster-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Keyword cluster not found.");
    expect(mockedPrisma.keywordCluster.update).not.toHaveBeenCalled();
  });

  it("3. sets deletedAt to a Date instance, nothing else, on the exact targeted cluster", async () => {
    await archiveCluster("cluster-1");
    const [{ where, data }] = mockedPrisma.keywordCluster.update.mock.calls[0];
    expect(where).toEqual({ id: "cluster-1" });
    expect(Object.keys(data)).toEqual(["deletedAt"]);
    expect(data.deletedAt).toBeInstanceOf(Date);
  });

  it("4. logs keyword_cluster.archived", async () => {
    await archiveCluster("cluster-1");
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "keyword_cluster.archived",
      companyId: COMPANY_A,
      seoProjectId: "seo-1",
      metadata: { clusterId: "cluster-1" },
    });
  });

  it("5. revalidates the clusters list", async () => {
    const { revalidatePath } = await import("next/cache");
    await archiveCluster("cluster-1");
    expect(revalidatePath).toHaveBeenCalledWith("/seo/seo-1/clusters");
  });

  it("6. returns success", async () => {
    const result = await archiveCluster("cluster-1");
    expect(result.success).toBe(true);
  });
});

describe("restoreCluster", () => {
  it("1. rejects an EMPLOYEE", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await restoreCluster("cluster-1");
    expect(result.success).toBe(false);
    expect(mockedPrisma.keywordCluster.update).not.toHaveBeenCalled();
  });

  it("2. returns 'Keyword cluster not found.' for a missing/cross-company cluster (tenant isolation)", async () => {
    mockedPrisma.keywordCluster.findUnique.mockResolvedValue(
      makeClusterWithProject({ seoProject: { id: "seo-1", companyId: COMPANY_B } })
    );
    const result = await restoreCluster("cluster-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Keyword cluster not found.");
    expect(mockedPrisma.keywordCluster.update).not.toHaveBeenCalled();
  });

  it("3. sets deletedAt to null", async () => {
    await restoreCluster("cluster-1");
    expect(mockedPrisma.keywordCluster.update).toHaveBeenCalledWith({
      where: { id: "cluster-1" },
      data: { deletedAt: null },
    });
  });

  it("4. logs keyword_cluster.restored", async () => {
    await restoreCluster("cluster-1");
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "keyword_cluster.restored",
      companyId: COMPANY_A,
      seoProjectId: "seo-1",
      metadata: { clusterId: "cluster-1" },
    });
  });

  it("5. revalidates the clusters list", async () => {
    const { revalidatePath } = await import("next/cache");
    await restoreCluster("cluster-1");
    expect(revalidatePath).toHaveBeenCalledWith("/seo/seo-1/clusters");
  });

  it("6. returns success", async () => {
    const result = await restoreCluster("cluster-1");
    expect(result.success).toBe(true);
  });
});
