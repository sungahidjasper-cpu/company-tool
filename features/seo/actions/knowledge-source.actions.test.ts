import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/features/seo/services/knowledge-source.service", () => ({
  getKnowledgeSourceById: vi.fn(),
  listKnowledgeSources: vi.fn(),
  listKnowledgeSourceLinksForSeoProject: vi.fn(),
  findDuplicateKnowledgeSourceByUrl: vi.fn(),
}));

type MockPrisma = {
  knowledgeSource: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  knowledgeSourceLink: {
    create: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
  sEOProject: { findUnique: ReturnType<typeof vi.fn> };
};

function createMockPrisma(): MockPrisma {
  return {
    knowledgeSource: { create: vi.fn(), update: vi.fn() },
    knowledgeSourceLink: { create: vi.fn(), delete: vi.fn(), findUnique: vi.fn() },
    sEOProject: { findUnique: vi.fn() },
  };
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { requireUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  findDuplicateKnowledgeSourceByUrl,
  getKnowledgeSourceById,
  listKnowledgeSourceLinksForSeoProject,
  listKnowledgeSources,
} from "@/features/seo/services/knowledge-source.service";
import {
  archiveKnowledgeSource,
  createKnowledgeSource,
  linkKnowledgeSourceToSeoProject,
  listKnowledgeSourceLinksForSeoProjectAction,
  listKnowledgeSourcesAction,
  restoreKnowledgeSource,
  unlinkKnowledgeSource,
  updateKnowledgeSource,
} from "@/features/seo/actions/knowledge-source.actions";

const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedLogActivity = logActivity as unknown as ReturnType<typeof vi.fn>;
const mockedRevalidatePath = revalidatePath as unknown as ReturnType<typeof vi.fn>;
const mockedPrisma = prisma as unknown as MockPrisma;
const mockedGetKnowledgeSourceById = getKnowledgeSourceById as unknown as ReturnType<typeof vi.fn>;
const mockedListKnowledgeSources = listKnowledgeSources as unknown as ReturnType<typeof vi.fn>;
const mockedListKnowledgeSourceLinksForSeoProject = listKnowledgeSourceLinksForSeoProject as unknown as ReturnType<typeof vi.fn>;
const mockedFindDuplicateKnowledgeSourceByUrl = findDuplicateKnowledgeSourceByUrl as unknown as ReturnType<typeof vi.fn>;

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";
const MANAGER = { id: "user-1", role: "MANAGER", companyId: COMPANY_A };
const EMPLOYEE = { id: "user-2", role: "EMPLOYEE", companyId: COMPANY_A };

function makeSource(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "source-1",
    companyId: COMPANY_A,
    title: "Google Search Central",
    url: "https://developers.google.com/search",
    sourceType: "SEARCH_ENGINE_DOCUMENTATION",
    description: null,
    content: null,
    publishedAt: null,
    lastVerifiedAt: null,
    addedByUserId: MANAGER.id,
    deletedAt: null,
    ...overrides,
  };
}

function makeSeoProject(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: "seo-project-1", companyId: COMPANY_A, ...overrides };
}

const VALID_INPUT = {
  title: "Google Search Central",
  url: "https://developers.google.com/search",
  sourceType: "SEARCH_ENGINE_DOCUMENTATION",
  description: "Official Google Search documentation",
  content: "",
  publishedAt: "",
  lastVerifiedAt: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequireUser.mockResolvedValue(MANAGER);
  mockedFindDuplicateKnowledgeSourceByUrl.mockResolvedValue(null);
});

describe("createKnowledgeSource", () => {
  it("1. denies an EMPLOYEE without touching prisma", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await createKnowledgeSource(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to add knowledge sources.");
    expect(mockedPrisma.knowledgeSource.create).not.toHaveBeenCalled();
  });

  it("2. rejects an empty title without touching prisma", async () => {
    const result = await createKnowledgeSource({ ...VALID_INPUT, title: "x" });
    expect(result.success).toBe(false);
    expect(mockedPrisma.knowledgeSource.create).not.toHaveBeenCalled();
  });

  it("3. rejects an invalid URL without touching prisma", async () => {
    const result = await createKnowledgeSource({ ...VALID_INPUT, url: "not-a-url" });
    expect(result.success).toBe(false);
    expect(mockedPrisma.knowledgeSource.create).not.toHaveBeenCalled();
  });

  it("4. [CRITICAL] rejects a duplicate URL scoped to the actor's own company, without creating", async () => {
    mockedFindDuplicateKnowledgeSourceByUrl.mockResolvedValue({ id: "existing-source", url: VALID_INPUT.url });
    const result = await createKnowledgeSource(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("A knowledge source with this URL already exists.");
    expect(mockedFindDuplicateKnowledgeSourceByUrl).toHaveBeenCalledWith(COMPANY_A, VALID_INPUT.url);
    expect(mockedPrisma.knowledgeSource.create).not.toHaveBeenCalled();
  });

  it("5. skips the duplicate check entirely when no URL is supplied", async () => {
    mockedPrisma.knowledgeSource.create.mockResolvedValue(makeSource({ url: null }));
    await createKnowledgeSource({ ...VALID_INPUT, url: "" });
    expect(mockedFindDuplicateKnowledgeSourceByUrl).not.toHaveBeenCalled();
  });

  it("6. creates with the exact company-scoped, attributed payload", async () => {
    mockedPrisma.knowledgeSource.create.mockResolvedValue(makeSource());
    await createKnowledgeSource(VALID_INPUT);
    expect(mockedPrisma.knowledgeSource.create).toHaveBeenCalledWith({
      data: {
        companyId: COMPANY_A,
        title: "Google Search Central",
        url: "https://developers.google.com/search",
        sourceType: "SEARCH_ENGINE_DOCUMENTATION",
        description: "Official Google Search documentation",
        content: null,
        publishedAt: null,
        lastVerifiedAt: null,
        addedByUserId: MANAGER.id,
      },
    });
  });

  it("7. [CRITICAL] scopes creation to the ACTING user's own company — a different actor produces a different companyId", async () => {
    const actorB = { id: "user-3", role: "MANAGER", companyId: COMPANY_B };
    mockedRequireUser.mockResolvedValue(actorB);
    mockedPrisma.knowledgeSource.create.mockResolvedValue(makeSource({ companyId: COMPANY_B }));
    await createKnowledgeSource(VALID_INPUT);
    const [{ data }] = mockedPrisma.knowledgeSource.create.mock.calls[0];
    expect(data.companyId).toBe(COMPANY_B);
  });

  it("8. logs activity with the exact metadata", async () => {
    mockedPrisma.knowledgeSource.create.mockResolvedValue(makeSource());
    await createKnowledgeSource(VALID_INPUT);
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "knowledge_source.created",
      companyId: COMPANY_A,
      metadata: { knowledgeSourceId: "source-1", title: "Google Search Central" },
    });
  });

  it("9. revalidates /seo and returns the new id", async () => {
    mockedPrisma.knowledgeSource.create.mockResolvedValue(makeSource());
    const result = await createKnowledgeSource(VALID_INPUT);
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/seo");
    expect(result).toEqual({ success: true, data: { id: "source-1" } });
  });
});

describe("updateKnowledgeSource", () => {
  beforeEach(() => {
    mockedGetKnowledgeSourceById.mockResolvedValue(makeSource());
  });

  it("1. denies an EMPLOYEE without looking up the source", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await updateKnowledgeSource("source-1", VALID_INPUT);
    expect(result.success).toBe(false);
    expect(mockedGetKnowledgeSourceById).not.toHaveBeenCalled();
  });

  it("2. rejects when the source does not exist, without updating", async () => {
    mockedGetKnowledgeSourceById.mockResolvedValue(null);
    const result = await updateKnowledgeSource("source-1", VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Knowledge source not found.");
    expect(mockedPrisma.knowledgeSource.update).not.toHaveBeenCalled();
  });

  it("3. [CRITICAL] rejects a cross-company source with the same not-found message, without updating", async () => {
    mockedGetKnowledgeSourceById.mockResolvedValue(makeSource({ companyId: COMPANY_B }));
    const result = await updateKnowledgeSource("source-1", VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Knowledge source not found.");
    expect(mockedPrisma.knowledgeSource.update).not.toHaveBeenCalled();
  });

  it("4. rejects invalid input without updating", async () => {
    const result = await updateKnowledgeSource("source-1", { ...VALID_INPUT, title: "x" });
    expect(result.success).toBe(false);
    expect(mockedPrisma.knowledgeSource.update).not.toHaveBeenCalled();
  });

  it("5. rejects a URL that duplicates a DIFFERENT existing source", async () => {
    mockedFindDuplicateKnowledgeSourceByUrl.mockResolvedValue({ id: "some-other-source", url: VALID_INPUT.url });
    const result = await updateKnowledgeSource("source-1", VALID_INPUT);
    expect(result.success).toBe(false);
    expect(mockedPrisma.knowledgeSource.update).not.toHaveBeenCalled();
  });

  it("6. allows saving when the 'duplicate' found is the source's own unchanged URL", async () => {
    mockedFindDuplicateKnowledgeSourceByUrl.mockResolvedValue({ id: "source-1", url: VALID_INPUT.url });
    mockedPrisma.knowledgeSource.update.mockResolvedValue(makeSource());
    const result = await updateKnowledgeSource("source-1", VALID_INPUT);
    expect(result.success).toBe(true);
    expect(mockedPrisma.knowledgeSource.update).toHaveBeenCalled();
  });

  it("7. updates with the exact payload, never touching companyId/addedByUserId", async () => {
    mockedPrisma.knowledgeSource.update.mockResolvedValue(makeSource({ title: "Updated title" }));
    await updateKnowledgeSource("source-1", { ...VALID_INPUT, title: "Updated title" });
    expect(mockedPrisma.knowledgeSource.update).toHaveBeenCalledWith({
      where: { id: "source-1" },
      data: {
        title: "Updated title",
        url: "https://developers.google.com/search",
        sourceType: "SEARCH_ENGINE_DOCUMENTATION",
        description: "Official Google Search documentation",
        content: null,
        publishedAt: null,
        lastVerifiedAt: null,
      },
    });
  });

  it("8. revalidates /seo and returns the id", async () => {
    mockedPrisma.knowledgeSource.update.mockResolvedValue(makeSource());
    const result = await updateKnowledgeSource("source-1", VALID_INPUT);
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/seo");
    expect(result).toEqual({ success: true, data: { id: "source-1" } });
  });
});

describe("archiveKnowledgeSource", () => {
  beforeEach(() => {
    mockedGetKnowledgeSourceById.mockResolvedValue(makeSource());
  });

  it("1. denies an EMPLOYEE without touching prisma", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await archiveKnowledgeSource("source-1");
    expect(result.success).toBe(false);
    expect(mockedPrisma.knowledgeSource.update).not.toHaveBeenCalled();
  });

  it("2. [CRITICAL] rejects a cross-company source, without archiving", async () => {
    mockedGetKnowledgeSourceById.mockResolvedValue(makeSource({ companyId: COMPANY_B }));
    const result = await archiveKnowledgeSource("source-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Knowledge source not found.");
    expect(mockedPrisma.knowledgeSource.update).not.toHaveBeenCalled();
  });

  it("3. sets deletedAt with the exact payload", async () => {
    const before = Date.now();
    await archiveKnowledgeSource("source-1");
    const [{ where, data }] = mockedPrisma.knowledgeSource.update.mock.calls[0];
    expect(where).toEqual({ id: "source-1" });
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect((data.deletedAt as Date).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("4. logs activity and revalidates /seo", async () => {
    await archiveKnowledgeSource("source-1");
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "knowledge_source.archived",
      companyId: COMPANY_A,
      metadata: { knowledgeSourceId: "source-1" },
    });
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/seo");
  });
});

describe("restoreKnowledgeSource", () => {
  beforeEach(() => {
    mockedGetKnowledgeSourceById.mockResolvedValue(makeSource({ deletedAt: new Date() }));
  });

  it("1. denies an EMPLOYEE without touching prisma", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await restoreKnowledgeSource("source-1");
    expect(result.success).toBe(false);
    expect(mockedPrisma.knowledgeSource.update).not.toHaveBeenCalled();
  });

  it("2. [CRITICAL] rejects a cross-company source, without restoring", async () => {
    mockedGetKnowledgeSourceById.mockResolvedValue(makeSource({ companyId: COMPANY_B }));
    const result = await restoreKnowledgeSource("source-1");
    expect(result.success).toBe(false);
    expect(mockedPrisma.knowledgeSource.update).not.toHaveBeenCalled();
  });

  it("3. clears deletedAt with the exact payload", async () => {
    await restoreKnowledgeSource("source-1");
    expect(mockedPrisma.knowledgeSource.update).toHaveBeenCalledWith({
      where: { id: "source-1" },
      data: { deletedAt: null },
    });
  });

  it("4. logs activity and revalidates /seo", async () => {
    await restoreKnowledgeSource("source-1");
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "knowledge_source.restored",
      companyId: COMPANY_A,
      metadata: { knowledgeSourceId: "source-1" },
    });
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/seo");
  });
});

describe("listKnowledgeSourcesAction", () => {
  it("1. succeeds for a plain EMPLOYEE — self-service, no role gate", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    mockedListKnowledgeSources.mockResolvedValue([]);
    const result = await listKnowledgeSourcesAction();
    expect(result.success).toBe(true);
  });

  it("2. [CRITICAL] scopes the list query to the ACTING user's own company", async () => {
    const actorB = { id: "user-3", role: "EMPLOYEE", companyId: COMPANY_B };
    mockedRequireUser.mockResolvedValue(actorB);
    mockedListKnowledgeSources.mockResolvedValue([]);
    await listKnowledgeSourcesAction();
    expect(mockedListKnowledgeSources).toHaveBeenCalledWith(COMPANY_B);
  });

  it("3. returns exactly the sources resolved by the service, unmodified", async () => {
    const sources = [makeSource()];
    mockedListKnowledgeSources.mockResolvedValue(sources);
    const result = await listKnowledgeSourcesAction();
    expect(result).toEqual({ success: true, data: sources });
  });
});

describe("linkKnowledgeSourceToSeoProject", () => {
  const SOURCE_UUID = "11111111-1111-7111-8111-111111111111";
  const SEO_PROJECT_UUID = "22222222-2222-7222-8222-222222222222";
  const LINK_INPUT = { knowledgeSourceId: SOURCE_UUID, seoProjectId: SEO_PROJECT_UUID, note: "Supports the on-page recommendations" };

  beforeEach(() => {
    mockedGetKnowledgeSourceById.mockResolvedValue(makeSource({ id: SOURCE_UUID }));
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(makeSeoProject({ id: SEO_PROJECT_UUID }));
  });

  it("1. denies an EMPLOYEE without looking up the source or project", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await linkKnowledgeSourceToSeoProject(LINK_INPUT);
    expect(result.success).toBe(false);
    expect(mockedGetKnowledgeSourceById).not.toHaveBeenCalled();
    expect(mockedPrisma.knowledgeSourceLink.create).not.toHaveBeenCalled();
  });

  it("2. rejects an invalid knowledgeSourceId without any lookup", async () => {
    const result = await linkKnowledgeSourceToSeoProject({ ...LINK_INPUT, knowledgeSourceId: "not-a-uuid" });
    expect(result.success).toBe(false);
    expect(mockedGetKnowledgeSourceById).not.toHaveBeenCalled();
  });

  it("3. [CRITICAL] rejects a cross-company source, without checking the project or creating a link", async () => {
    mockedGetKnowledgeSourceById.mockResolvedValue(makeSource({ id: SOURCE_UUID, companyId: COMPANY_B }));
    const result = await linkKnowledgeSourceToSeoProject(LINK_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Knowledge source not found.");
    expect(mockedPrisma.sEOProject.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.knowledgeSourceLink.create).not.toHaveBeenCalled();
  });

  it("4. [CRITICAL] rejects a cross-company SEO project, without creating a link", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(makeSeoProject({ id: SEO_PROJECT_UUID, companyId: COMPANY_B }));
    const result = await linkKnowledgeSourceToSeoProject(LINK_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("SEO project not found.");
    expect(mockedPrisma.knowledgeSourceLink.create).not.toHaveBeenCalled();
  });

  it("5. rejects a missing SEO project, without creating a link", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(null);
    const result = await linkKnowledgeSourceToSeoProject(LINK_INPUT);
    expect(result.success).toBe(false);
    expect(mockedPrisma.knowledgeSourceLink.create).not.toHaveBeenCalled();
  });

  it("6. creates the link with the exact payload", async () => {
    mockedPrisma.knowledgeSourceLink.create.mockResolvedValue({ id: "link-1" });
    await linkKnowledgeSourceToSeoProject(LINK_INPUT);
    expect(mockedPrisma.knowledgeSourceLink.create).toHaveBeenCalledWith({
      data: {
        knowledgeSourceId: SOURCE_UUID,
        seoProjectId: SEO_PROJECT_UUID,
        note: "Supports the on-page recommendations",
        createdByUserId: MANAGER.id,
      },
    });
  });

  it("7. logs activity scoped to the SEO project and revalidates its detail page", async () => {
    mockedPrisma.knowledgeSourceLink.create.mockResolvedValue({ id: "link-1" });
    const result = await linkKnowledgeSourceToSeoProject(LINK_INPUT);
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "knowledge_source.linked",
      companyId: COMPANY_A,
      seoProjectId: SEO_PROJECT_UUID,
      metadata: { knowledgeSourceId: SOURCE_UUID, linkId: "link-1" },
    });
    expect(mockedRevalidatePath).toHaveBeenCalledWith(`/seo/${SEO_PROJECT_UUID}`);
    expect(result).toEqual({ success: true, data: { id: "link-1" } });
  });
});

describe("unlinkKnowledgeSource", () => {
  function makeLink(overrides: Partial<Record<string, unknown>> = {}) {
    return { id: "link-1", seoProject: { id: "seo-project-1", companyId: COMPANY_A }, ...overrides };
  }

  beforeEach(() => {
    mockedPrisma.knowledgeSourceLink.findUnique.mockResolvedValue(makeLink());
  });

  it("1. denies an EMPLOYEE without touching prisma", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await unlinkKnowledgeSource("link-1");
    expect(result.success).toBe(false);
    expect(mockedPrisma.knowledgeSourceLink.delete).not.toHaveBeenCalled();
  });

  it("2. rejects a missing link", async () => {
    mockedPrisma.knowledgeSourceLink.findUnique.mockResolvedValue(null);
    const result = await unlinkKnowledgeSource("link-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Link not found.");
    expect(mockedPrisma.knowledgeSourceLink.delete).not.toHaveBeenCalled();
  });

  it("3. [CRITICAL] rejects a link whose SEO project belongs to a different company, without deleting", async () => {
    mockedPrisma.knowledgeSourceLink.findUnique.mockResolvedValue(makeLink({ seoProject: { id: "seo-project-1", companyId: COMPANY_B } }));
    const result = await unlinkKnowledgeSource("link-1");
    expect(result.success).toBe(false);
    expect(mockedPrisma.knowledgeSourceLink.delete).not.toHaveBeenCalled();
  });

  it("4. deletes the exact link id", async () => {
    await unlinkKnowledgeSource("link-1");
    expect(mockedPrisma.knowledgeSourceLink.delete).toHaveBeenCalledWith({ where: { id: "link-1" } });
  });

  it("5. logs activity scoped to the SEO project and revalidates its detail page", async () => {
    await unlinkKnowledgeSource("link-1");
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "knowledge_source.unlinked",
      companyId: COMPANY_A,
      seoProjectId: "seo-project-1",
      metadata: { linkId: "link-1" },
    });
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/seo/seo-project-1");
  });
});

describe("listKnowledgeSourceLinksForSeoProjectAction", () => {
  it("1. succeeds for a plain EMPLOYEE — self-service, no role gate", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(makeSeoProject());
    mockedListKnowledgeSourceLinksForSeoProject.mockResolvedValue([]);
    const result = await listKnowledgeSourceLinksForSeoProjectAction("seo-project-1");
    expect(result.success).toBe(true);
  });

  it("2. rejects a missing SEO project, without listing links", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(null);
    const result = await listKnowledgeSourceLinksForSeoProjectAction("seo-project-1");
    expect(result.success).toBe(false);
    expect(mockedListKnowledgeSourceLinksForSeoProject).not.toHaveBeenCalled();
  });

  it("3. [CRITICAL] rejects a cross-company SEO project, without listing links", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(makeSeoProject({ companyId: COMPANY_B }));
    const result = await listKnowledgeSourceLinksForSeoProjectAction("seo-project-1");
    expect(result.success).toBe(false);
    expect(mockedListKnowledgeSourceLinksForSeoProject).not.toHaveBeenCalled();
  });

  it("4. returns exactly the links resolved by the service, unmodified", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(makeSeoProject());
    const links = [{ id: "link-1" }];
    mockedListKnowledgeSourceLinksForSeoProject.mockResolvedValue(links);
    const result = await listKnowledgeSourceLinksForSeoProjectAction("seo-project-1");
    expect(result).toEqual({ success: true, data: links });
  });
});
