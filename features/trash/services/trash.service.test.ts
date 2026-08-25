import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/files/services/entity-target", () => ({
  resolveEntityTypeFromFile: vi.fn(),
  getEntityIdFromFile: vi.fn(),
}));

type MockPrisma = {
  file: { findMany: ReturnType<typeof vi.fn> };
  note: { findMany: ReturnType<typeof vi.fn> };
  content: { findMany: ReturnType<typeof vi.fn> };
  keyword: { findMany: ReturnType<typeof vi.fn> };
  contentRevision: { findMany: ReturnType<typeof vi.fn> };
  client: { findMany: ReturnType<typeof vi.fn> };
  project: { findMany: ReturnType<typeof vi.fn> };
  lead: { findMany: ReturnType<typeof vi.fn> };
  sEOProject: { findMany: ReturnType<typeof vi.fn> };
  task: { findMany: ReturnType<typeof vi.fn> };
  company: { findMany: ReturnType<typeof vi.fn> };
  user: { findMany: ReturnType<typeof vi.fn> };
};

function createMockPrisma(): MockPrisma {
  return {
    file: { findMany: vi.fn().mockResolvedValue([]) },
    note: { findMany: vi.fn().mockResolvedValue([]) },
    content: { findMany: vi.fn().mockResolvedValue([]) },
    keyword: { findMany: vi.fn().mockResolvedValue([]) },
    contentRevision: { findMany: vi.fn().mockResolvedValue([]) },
    client: { findMany: vi.fn().mockResolvedValue([]) },
    project: { findMany: vi.fn().mockResolvedValue([]) },
    lead: { findMany: vi.fn().mockResolvedValue([]) },
    sEOProject: { findMany: vi.fn().mockResolvedValue([]) },
    task: { findMany: vi.fn().mockResolvedValue([]) },
    company: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { prisma } from "@/lib/prisma";
import { resolveEntityTypeFromFile, getEntityIdFromFile } from "@/features/files/services/entity-target";
import { getTrashItems } from "@/features/trash/services/trash.service";

const mockedPrisma = prisma as unknown as MockPrisma;
const mockedResolveEntityTypeFromFile = resolveEntityTypeFromFile as unknown as ReturnType<typeof vi.fn>;
const mockedGetEntityIdFromFile = getEntityIdFromFile as unknown as ReturnType<typeof vi.fn>;

const COMPANY_A = "company-a";

beforeEach(() => {
  vi.clearAllMocks();
  mockedPrisma.file.findMany.mockResolvedValue([]);
  mockedPrisma.note.findMany.mockResolvedValue([]);
  mockedPrisma.content.findMany.mockResolvedValue([]);
  mockedPrisma.keyword.findMany.mockResolvedValue([]);
  mockedPrisma.contentRevision.findMany.mockResolvedValue([]);
  mockedPrisma.client.findMany.mockResolvedValue([]);
  mockedPrisma.project.findMany.mockResolvedValue([]);
  mockedPrisma.lead.findMany.mockResolvedValue([]);
  mockedPrisma.sEOProject.findMany.mockResolvedValue([]);
  mockedPrisma.task.findMany.mockResolvedValue([]);
  mockedPrisma.company.findMany.mockResolvedValue([]);
  mockedPrisma.user.findMany.mockResolvedValue([]);
});

describe("getTrashItems — tenant isolation", () => {
  it("scopes the File query with an OR-join across every possible parent relation, not a flat companyId filter", async () => {
    // File.companyId is only populated for company-targeted files (see entity-target.ts's
    // buildEntityWhere) — a flat companyId filter would silently miss client/project/task/
    // lead/seoProject/content/user-attached files, which is most of them in practice.
    await getTrashItems(COMPANY_A);
    const [{ where }] = mockedPrisma.file.findMany.mock.calls[0];
    expect(where.deletedAt).toEqual({ not: null });
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

  it("scopes the Content query by seoProject.companyId with deletedAt: { not: null }", async () => {
    await getTrashItems(COMPANY_A);
    expect(mockedPrisma.content.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { seoProject: { companyId: COMPANY_A }, deletedAt: { not: null } } })
    );
  });

  it("scopes the Keyword query by seoProject.companyId with deletedAt: { not: null }", async () => {
    await getTrashItems(COMPANY_A);
    expect(mockedPrisma.keyword.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { seoProject: { companyId: COMPANY_A }, deletedAt: { not: null } } })
    );
  });

  it("scopes the Note query with a company-derived OR across all six parent relations", async () => {
    await getTrashItems(COMPANY_A);
    const [{ where }] = mockedPrisma.note.findMany.mock.calls[0];
    expect(where.deletedAt).toEqual({ not: null });
    expect(where.OR).toEqual([
      { lead: { companyId: COMPANY_A } },
      { project: { companyId: COMPANY_A } },
      { client: { companyId: COMPANY_A } },
      { seoProject: { companyId: COMPANY_A } },
      { content: { seoProject: { companyId: COMPANY_A } } },
      { task: { project: { companyId: COMPANY_A } } },
    ]);
  });
});

describe("getTrashItems — Content", () => {
  it("returns a normalized row with purgeAvailable true when no ContentRevision blocks it", async () => {
    mockedPrisma.content.findMany.mockResolvedValue([
      { id: "content-1", title: "SEO Article", deletedAt: new Date("2026-08-20"), seoProjectId: "seo-1", seoProject: { name: "Acme SEO" } },
    ]);
    mockedPrisma.contentRevision.findMany.mockResolvedValue([]);

    const items = await getTrashItems(COMPANY_A);
    const row = items.find((i) => i.entityType === "content");

    expect(row).toMatchObject({
      id: "content-1",
      entityType: "content",
      displayName: "SEO Article",
      parentLabel: "Acme SEO",
      parentHref: "/seo/seo-1",
      restoreAvailable: true,
      purgeAvailable: true,
    });
  });

  it("sets purgeAvailable false when ContentRevision blocks the id", async () => {
    mockedPrisma.content.findMany.mockResolvedValue([
      { id: "content-1", title: "SEO Article", deletedAt: new Date("2026-08-20"), seoProjectId: "seo-1", seoProject: { name: "Acme SEO" } },
    ]);
    mockedPrisma.contentRevision.findMany.mockResolvedValue([{ contentId: "content-1" }]);

    const items = await getTrashItems(COMPANY_A);
    const row = items.find((i) => i.entityType === "content");

    expect(row?.purgeAvailable).toBe(false);
  });

  it("skips the ContentRevision query entirely when there is no trashed content", async () => {
    mockedPrisma.content.findMany.mockResolvedValue([]);
    await getTrashItems(COMPANY_A);
    expect(mockedPrisma.contentRevision.findMany).not.toHaveBeenCalled();
  });
});

describe("getTrashItems — Keyword", () => {
  it("returns a normalized row with purgeAvailable always true", async () => {
    mockedPrisma.keyword.findMany.mockResolvedValue([
      { id: "kw-1", term: "emergency plumber austin", deletedAt: new Date("2026-08-19"), seoProjectId: "seo-1", seoProject: { name: "Acme SEO" } },
    ]);

    const items = await getTrashItems(COMPANY_A);
    const row = items.find((i) => i.entityType === "keyword");

    expect(row).toMatchObject({
      id: "kw-1",
      entityType: "keyword",
      displayName: "emergency plumber austin",
      parentLabel: "Acme SEO",
      parentHref: "/seo/seo-1",
      restoreAvailable: true,
      purgeAvailable: true,
    });
  });
});

describe("getTrashItems — File", () => {
  it("resolves the parent type/id via entity-target and looks up its label/href in one batched query", async () => {
    mockedPrisma.file.findMany.mockResolvedValue([
      { id: "file-1", fileName: "report.pdf", deletedAt: new Date("2026-08-18"), clientId: "client-1" },
    ]);
    mockedResolveEntityTypeFromFile.mockReturnValue("client");
    mockedGetEntityIdFromFile.mockReturnValue("client-1");
    mockedPrisma.client.findMany.mockResolvedValue([{ id: "client-1", name: "Acme Plumbing" }]);

    const items = await getTrashItems(COMPANY_A);
    const row = items.find((i) => i.entityType === "file");

    expect(row).toMatchObject({
      id: "file-1",
      displayName: "report.pdf",
      parentLabel: "Acme Plumbing",
      parentHref: "/clients/client-1",
      restoreAvailable: true,
      purgeAvailable: false,
    });
    expect(mockedPrisma.client.findMany).toHaveBeenCalledTimes(1);
  });

  it("batches the parent lookup once per type, not once per file (no N+1)", async () => {
    mockedPrisma.file.findMany.mockResolvedValue([
      { id: "file-1", fileName: "a.pdf", deletedAt: new Date(), clientId: "client-1" },
      { id: "file-2", fileName: "b.pdf", deletedAt: new Date(), clientId: "client-2" },
      { id: "file-3", fileName: "c.pdf", deletedAt: new Date(), clientId: "client-1" },
    ]);
    mockedResolveEntityTypeFromFile.mockReturnValue("client");
    mockedGetEntityIdFromFile
      .mockReturnValueOnce("client-1")
      .mockReturnValueOnce("client-2")
      .mockReturnValueOnce("client-1");

    await getTrashItems(COMPANY_A);

    expect(mockedPrisma.client.findMany).toHaveBeenCalledTimes(1);
    const [{ where }] = mockedPrisma.client.findMany.mock.calls[0];
    expect(where.id.in.sort()).toEqual(["client-1", "client-2"]);
  });

  it("leaves parentLabel/parentHref null when the entity type can't be resolved", async () => {
    mockedPrisma.file.findMany.mockResolvedValue([{ id: "file-1", fileName: "a.pdf", deletedAt: new Date() }]);
    mockedResolveEntityTypeFromFile.mockReturnValue(null);

    const items = await getTrashItems(COMPANY_A);
    const row = items.find((i) => i.entityType === "file");

    expect(row?.parentLabel).toBeNull();
    expect(row?.parentHref).toBeNull();
  });
});

describe("getTrashItems — Note", () => {
  it("resolves the parent type from whichever FK is set and looks up its label/href", async () => {
    mockedPrisma.note.findMany.mockResolvedValue([
      { id: "note-1", body: "Client requested a call back", deletedAt: new Date("2026-08-17"), leadId: "lead-1", projectId: null, clientId: null, seoProjectId: null, contentId: null, taskId: null },
    ]);
    mockedPrisma.lead.findMany.mockResolvedValue([{ id: "lead-1", name: "Jane Prospect" }]);

    const items = await getTrashItems(COMPANY_A);
    const row = items.find((i) => i.entityType === "note");

    expect(row).toMatchObject({
      id: "note-1",
      displayName: "Client requested a call back",
      parentLabel: "Jane Prospect",
      parentHref: "/leads/lead-1",
      restoreAvailable: true,
      purgeAvailable: false,
    });
    expect(row?.identifiers).toEqual({ entityType: "note", noteId: "note-1", noteParentType: "lead" });
  });

  it("truncates a long note body for displayName", async () => {
    const longBody = "x".repeat(200);
    mockedPrisma.note.findMany.mockResolvedValue([
      { id: "note-1", body: longBody, deletedAt: new Date(), leadId: "lead-1", projectId: null, clientId: null, seoProjectId: null, contentId: null, taskId: null },
    ]);

    const items = await getTrashItems(COMPANY_A);
    const row = items.find((i) => i.entityType === "note");

    expect(row?.displayName.length).toBeLessThan(longBody.length);
  });

  it("excludes a note with no resolvable parent rather than crashing", async () => {
    mockedPrisma.note.findMany.mockResolvedValue([
      { id: "note-1", body: "orphaned", deletedAt: new Date(), leadId: null, projectId: null, clientId: null, seoProjectId: null, contentId: null, taskId: null },
    ]);

    const items = await getTrashItems(COMPANY_A);
    expect(items.find((i) => i.entityType === "note")).toBeUndefined();
  });
});

describe("getTrashItems — normalized output", () => {
  it("sorts all four entity types together by deletedAt, newest first", async () => {
    mockedPrisma.content.findMany.mockResolvedValue([
      { id: "content-1", title: "Old content", deletedAt: new Date("2026-08-01"), seoProjectId: "seo-1", seoProject: { name: "SEO" } },
    ]);
    mockedPrisma.keyword.findMany.mockResolvedValue([
      { id: "kw-1", term: "newest", deletedAt: new Date("2026-08-25"), seoProjectId: "seo-1", seoProject: { name: "SEO" } },
    ]);
    mockedPrisma.file.findMany.mockResolvedValue([
      { id: "file-1", fileName: "middle.pdf", deletedAt: new Date("2026-08-15") },
    ]);
    mockedResolveEntityTypeFromFile.mockReturnValue(null);

    const items = await getTrashItems(COMPANY_A);

    expect(items.map((i) => i.id)).toEqual(["kw-1", "file-1", "content-1"]);
  });

  it("returns an empty array when nothing is trashed", async () => {
    const items = await getTrashItems(COMPANY_A);
    expect(items).toEqual([]);
  });
});
