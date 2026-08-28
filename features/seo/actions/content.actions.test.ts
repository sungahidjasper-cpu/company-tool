import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
// mention.service is intentionally left REAL here (Stage 16) — addContentNote is
// responsible for invoking it, and its real logic (matching @FirstName against
// real company members, excluding the author) must actually execute against the
// mocked prisma.user.findMany below, not a pre-baked mock return value.
vi.mock("@/features/notifications/services/notification.service", () => ({ createNotification: vi.fn() }));

type MockPrisma = {
  content: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  contentRevision: { count: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  note: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  file: { count: ReturnType<typeof vi.fn> };
  activity: { count: ReturnType<typeof vi.fn> };
  sEOProject: { findUnique: ReturnType<typeof vi.fn> };
  user: { findMany: ReturnType<typeof vi.fn> };
  $queryRaw: ReturnType<typeof vi.fn>;
  $transaction: ReturnType<typeof vi.fn>;
};

function createMockPrisma(): MockPrisma {
  const prisma = {
    content: {
      findUnique: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
    contentRevision: {
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({ id: "revision-1" }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    note: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn().mockResolvedValue(0), create: vi.fn() },
    file: { count: vi.fn().mockResolvedValue(0) },
    activity: { count: vi.fn().mockResolvedValue(0) },
    sEOProject: { findUnique: vi.fn() },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    $queryRaw: vi.fn().mockResolvedValue(undefined),
  } as unknown as MockPrisma;
  prisma.$transaction = vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") return (arg as (tx: MockPrisma) => unknown)(prisma);
    return Promise.all(arg as Promise<unknown>[]);
  });
  return prisma;
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { requireUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { createNotification } from "@/features/notifications/services/notification.service";
import {
  bulkDeleteContent,
  deleteContentNote,
  getContentDeletionImpact,
  restoreContentNote,
  updateContent,
  updateContentNote,
  createContent,
  advanceContentStatus,
  archiveContent,
  restoreContent,
  addContentNote,
  bulkArchiveContent,
  bulkRestoreContent,
  bulkPublishContent,
  importContentCsv,
} from "@/features/seo/actions/content.actions";
import type { ContentInput } from "@/features/seo/schemas/content.schema";

const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedLogActivity = logActivity as unknown as ReturnType<typeof vi.fn>;
const mockedRevalidatePath = revalidatePath as unknown as ReturnType<typeof vi.fn>;
const mockedPrisma = prisma as unknown as MockPrisma;
const mockedCreateNotification = createNotification as unknown as ReturnType<typeof vi.fn>;

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";
const MANAGER = { id: "user-1", role: "MANAGER", companyId: COMPANY_A, firstName: "Morgan" };
const EMPLOYEE = { id: "user-2", role: "EMPLOYEE", companyId: COMPANY_A, firstName: "Alex" };

const SEO_PROJECT = { id: "seo-1", companyId: COMPANY_A };

const VALID_CONTENT_INPUT: ContentInput = {
  title: "New Article",
  url: "",
  status: "DRAFT",
  publishedAt: "",
  authorId: "",
  keywordIds: undefined,
  body: "",
};

function makeFormDataWithFile(csvText: string, filename = "content.csv") {
  const formData = new FormData();
  const file = new File([csvText], filename, { type: "text/csv" });
  formData.set("file", file);
  return formData;
}

function makeExistingContent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "content-1",
    title: "Old Title",
    url: null,
    status: "DRAFT",
    publishedAt: null,
    authorId: null,
    metaTitle: "Old Meta Title",
    metaDescription: "Old Meta Description",
    body: "Old body",
    seoProject: { id: "seo-1", companyId: COMPANY_A },
    ...overrides,
  };
}

function makeInput(overrides: Partial<ContentInput> = {}): ContentInput {
  return {
    title: "Old Title",
    url: "",
    status: "DRAFT",
    publishedAt: "",
    authorId: "",
    keywordIds: [],
    body: "Old body",
    ...overrides,
  };
}

describe("updateContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    const existing = makeExistingContent();
    mockedPrisma.content.findUnique.mockResolvedValue(existing);
    mockedPrisma.content.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...existing,
      ...data,
    }));
    mockedPrisma.contentRevision.count.mockResolvedValue(0);
  });

  it("denies an EMPLOYEE", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await updateContent("content-1", makeInput());
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
  });

  it("rejects when the actor's company differs from the Content's company", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(makeExistingContent({ seoProject: { id: "seo-1", companyId: COMPANY_B } }));
    const result = await updateContent("content-1", makeInput());
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
  });

  describe("1. manual edit creates a MANUAL_EDIT revision with exact pre-change values", () => {
    it("captures the pre-change title/metaTitle/metaDescription/body when title changes", async () => {
      await updateContent("content-1", makeInput({ title: "New Title" }));

      expect(mockedPrisma.contentRevision.create).toHaveBeenCalledWith({
        data: {
          contentId: "content-1",
          companyId: COMPANY_A,
          revisionNumber: 1,
          title: "Old Title",
          metaTitle: "Old Meta Title",
          metaDescription: "Old Meta Description",
          body: "Old body",
          changeSource: "MANUAL_EDIT",
          createdByUserId: "user-1",
        },
      });
    });
  });

  describe("3. revision is created before the new Content values are persisted", () => {
    it("calls contentRevision.create before content.update", async () => {
      const callOrder: string[] = [];
      mockedPrisma.contentRevision.create.mockImplementation(async () => {
        callOrder.push("revision");
        return { id: "revision-1" };
      });
      mockedPrisma.content.update.mockImplementation(async () => {
        callOrder.push("update");
        return { id: "content-1", title: "New Title" };
      });

      await updateContent("content-1", makeInput({ title: "New Title" }));

      expect(callOrder).toEqual(["revision", "update"]);
    });
  });

  describe("4. no revision is created when tracked fields are unchanged", () => {
    it("skips the revision when title and body are identical, even if other fields change", async () => {
      await updateContent("content-1", makeInput({ status: "IN_REVIEW" }));

      expect(mockedPrisma.contentRevision.create).not.toHaveBeenCalled();
      expect(mockedPrisma.content.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: "IN_REVIEW" }) })
      );
    });

    it("creates a revision when only body changes, even if title is identical", async () => {
      await updateContent("content-1", makeInput({ body: "New body" }));
      expect(mockedPrisma.contentRevision.create).toHaveBeenCalled();
    });
  });

  describe("5. revision and Content update roll back together when the mutation fails", () => {
    it("propagates a content.update failure without logging activity or returning success", async () => {
      mockedPrisma.content.update.mockRejectedValue(new Error("simulated DB failure"));

      await expect(updateContent("content-1", makeInput({ title: "New Title" }))).rejects.toThrow("simulated DB failure");
      expect(mockedLogActivity).not.toHaveBeenCalled();
    });
  });

  describe("6. the revision uses the authenticated user's ID", () => {
    it("sets createdByUserId to actor.id, not any client-supplied value", async () => {
      await updateContent("content-1", makeInput({ title: "New Title" }));
      const [{ data }] = mockedPrisma.contentRevision.create.mock.calls[0];
      expect(data.createdByUserId).toBe(MANAGER.id);
    });
  });

  describe("7. the revision uses the server-authorized company ID, not client input", () => {
    it("sets companyId to actor.companyId — ContentInput has no client-supplied companyId field at all", async () => {
      await updateContent("content-1", makeInput({ title: "New Title" }));
      const [{ data }] = mockedPrisma.contentRevision.create.mock.calls[0];
      expect(data.companyId).toBe(COMPANY_A);
    });
  });

  describe("8. existing Content mutation behavior remains unchanged apart from revision creation", () => {
    it("still writes authorId/title/url/status/publishedAt/body/keywords exactly as before", async () => {
      await updateContent(
        "content-1",
        makeInput({ title: "New Title", url: "https://example.com", status: "APPROVED", publishedAt: "2026-01-01", authorId: "author-9", keywordIds: ["kw-1"] })
      );

      expect(mockedPrisma.content.update).toHaveBeenCalledWith({
        where: { id: "content-1" },
        data: {
          authorId: "author-9",
          title: "New Title",
          url: "https://example.com",
          status: "APPROVED",
          publishedAt: new Date("2026-01-01"),
          body: "Old body",
          keywords: { set: [{ id: "kw-1" }] },
        },
      });
    });

    it("still logs content.updated activity with the same shape as before", async () => {
      await updateContent("content-1", makeInput({ title: "New Title" }));
      expect(mockedLogActivity).toHaveBeenCalledWith(
        expect.objectContaining({ action: "content.updated", contentId: "content-1", metadata: { title: "New Title" } })
      );
    });
  });

  describe("fields not included in ContentRevision are never captured or modified by the revision mechanism", () => {
    it("never includes status or publishedAt in the ContentRevision snapshot data", async () => {
      await updateContent("content-1", makeInput({ title: "New Title", status: "APPROVED", publishedAt: "2026-01-01" }));

      const [{ data }] = mockedPrisma.contentRevision.create.mock.calls[0];
      expect(data).not.toHaveProperty("status");
      expect(data).not.toHaveProperty("publishedAt");
    });

    it("status/publishedAt on Content are updated normally, unaffected by whether a revision was created", async () => {
      await updateContent("content-1", makeInput({ status: "APPROVED", publishedAt: "2026-01-01" }));

      expect(mockedPrisma.contentRevision.create).not.toHaveBeenCalled();
      expect(mockedPrisma.content.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: "APPROVED", publishedAt: new Date("2026-01-01") }) })
      );
    });
  });

  describe("2. the transaction's own row-locked re-fetch returning null (content deleted between the outer check and the lock) is handled without mutating anything", () => {
    it("returns 'Content not found.' without calling content.update or contentRevision.create", async () => {
      // First call satisfies the outer getContentWithProject preflight check;
      // the second call is the transaction's own re-fetch under the row lock —
      // documents the existing defensive behavior for that race window, not a
      // claim that this is the only possible way to handle it.
      mockedPrisma.content.findUnique
        .mockResolvedValueOnce(makeExistingContent())
        .mockResolvedValueOnce(null);

      const result = await updateContent("content-1", makeInput({ title: "New Title" }));

      expect(result).toEqual({ success: false, message: "Content not found." });
      expect(mockedPrisma.content.update).not.toHaveBeenCalled();
      expect(mockedPrisma.contentRevision.create).not.toHaveBeenCalled();
    });
  });
});

describe("getContentDeletionImpact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ id: "seo-1", companyId: COMPANY_A });
    mockedPrisma.contentRevision.findMany.mockResolvedValue([]);
    mockedPrisma.note.count.mockResolvedValue(0);
    mockedPrisma.file.count.mockResolvedValue(0);
    mockedPrisma.activity.count.mockResolvedValue(0);
  });

  it("denies a non-manager before any DB call", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    await getContentDeletionImpact("seo-1", ["content-1"]);
    expect(mockedPrisma.sEOProject.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.note.count).not.toHaveBeenCalled();
  });

  it("rejects a cross-company SEO project", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ id: "seo-1", companyId: COMPANY_B });
    const result = await getContentDeletionImpact("seo-1", ["content-1"]);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/not found/i);
  });

  it("never mutates anything — no deleteMany, no update, no create", async () => {
    await getContentDeletionImpact("seo-1", ["content-1", "content-2"]);
    expect(mockedPrisma.content.deleteMany).not.toHaveBeenCalled();
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
    expect(mockedPrisma.contentRevision.create).not.toHaveBeenCalled();
  });

  it("counts eligible vs. blocked ids using the same query bulkDeleteContent uses", async () => {
    mockedPrisma.contentRevision.findMany.mockResolvedValue([{ contentId: "content-2" }]);

    const result = await getContentDeletionImpact("seo-1", ["content-1", "content-2", "content-3"]);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.eligibleCount).toBe(2);
      expect(result.data.blockedCount).toBe(1);
    }
    expect(mockedPrisma.contentRevision.findMany).toHaveBeenCalledWith({
      where: { contentId: { in: ["content-1", "content-2", "content-3"] } },
      select: { contentId: true },
      distinct: ["contentId"],
    });
  });

  it("counts Notes/Files/Activity scoped to the eligible ids only, excluding blocked ids", async () => {
    mockedPrisma.contentRevision.findMany.mockResolvedValue([{ contentId: "content-2" }]);
    mockedPrisma.note.count.mockResolvedValue(3);
    mockedPrisma.file.count.mockResolvedValue(1);
    mockedPrisma.activity.count.mockResolvedValue(7);

    const result = await getContentDeletionImpact("seo-1", ["content-1", "content-2"]);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ eligibleCount: 1, blockedCount: 1, noteCount: 3, fileCount: 1, activityCount: 7 });
    }
    expect(mockedPrisma.note.count).toHaveBeenCalledWith({ where: { contentId: { in: ["content-1"] } } });
    expect(mockedPrisma.file.count).toHaveBeenCalledWith({ where: { contentId: { in: ["content-1"] } } });
    expect(mockedPrisma.activity.count).toHaveBeenCalledWith({ where: { contentId: { in: ["content-1"] } } });
  });
});

describe("bulkDeleteContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ id: "seo-1", companyId: COMPANY_A });
    mockedPrisma.contentRevision.findMany.mockResolvedValue([]);
    mockedPrisma.content.deleteMany.mockResolvedValue({ count: 0 });
  });

  it("EMPLOYEE denial happens before any DB call", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    await bulkDeleteContent("seo-1", ["content-1"]);
    expect(mockedPrisma.sEOProject.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.content.deleteMany).not.toHaveBeenCalled();
  });

  describe("1. deletes eligible archived content with no revision history", () => {
    it("returns count matching the deleted rows and skippedCount: 0", async () => {
      mockedPrisma.contentRevision.findMany.mockResolvedValue([]);
      mockedPrisma.content.deleteMany.mockResolvedValue({ count: 2 });

      const result = await bulkDeleteContent("seo-1", ["content-1", "content-2"]);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual({ count: 2, skippedCount: 0 });
      expect(mockedPrisma.content.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ["content-1", "content-2"] }, seoProjectId: "seo-1", deletedAt: { not: null } },
      });
    });
  });

  describe("2. skips content with revision history", () => {
    it("excludes the revision-protected id from deleteMany and reports it as skipped", async () => {
      mockedPrisma.contentRevision.findMany.mockResolvedValue([{ contentId: "content-1" }]);
      mockedPrisma.content.deleteMany.mockResolvedValue({ count: 0 });

      const result = await bulkDeleteContent("seo-1", ["content-1"]);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual({ count: 0, skippedCount: 1 });
      expect(mockedPrisma.content.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: [] }, seoProjectId: "seo-1", deletedAt: { not: null } },
      });
      expect(mockedPrisma.contentRevision.findMany).toHaveBeenCalledWith({
        where: { contentId: { in: ["content-1"] } },
        select: { contentId: true },
        distinct: ["contentId"],
      });
    });

    it("never throws — the exact scenario this fix exists for (a plain deleteMany would FK-violate here)", async () => {
      mockedPrisma.contentRevision.findMany.mockResolvedValue([{ contentId: "content-1" }]);
      mockedPrisma.content.deleteMany.mockResolvedValue({ count: 0 });

      await expect(bulkDeleteContent("seo-1", ["content-1"])).resolves.not.toThrow();
    });
  });

  describe("3. mixed batch: some eligible, some blocked", () => {
    it("deletes the eligible ones and reports the blocked ones as skipped, in one call, no exception", async () => {
      mockedPrisma.contentRevision.findMany.mockResolvedValue([{ contentId: "content-2" }]);
      mockedPrisma.content.deleteMany.mockResolvedValue({ count: 2 });

      const result = await bulkDeleteContent("seo-1", ["content-1", "content-2", "content-3"]);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual({ count: 2, skippedCount: 1 });
      expect(mockedPrisma.content.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ["content-1", "content-3"] }, seoProjectId: "seo-1", deletedAt: { not: null } },
      });
    });
  });

  describe("4. non-archived ids remain excluded and are counted as skipped rather than silently invisible", () => {
    it("when an eligible (non-revision-protected) id isn't actually archived, deleteMany's own filter excludes it and it surfaces in skippedCount", async () => {
      mockedPrisma.contentRevision.findMany.mockResolvedValue([]);
      // Both ids are passed to deleteMany (neither is revision-protected), but only 1 actually
      // matches deletedAt: { not: null } in the real DB — simulated here via the resolved count.
      mockedPrisma.content.deleteMany.mockResolvedValue({ count: 1 });

      const result = await bulkDeleteContent("seo-1", ["content-1", "content-2"]);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual({ count: 1, skippedCount: 1 });
    });
  });

  describe("5. permission and tenant gates", () => {
    it("denies a non-manager", async () => {
      mockedRequireUser.mockResolvedValue(EMPLOYEE);
      const result = await bulkDeleteContent("seo-1", ["content-1"]);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toMatch(/permission/i);
    });

    it("rejects a cross-company SEO project", async () => {
      mockedPrisma.sEOProject.findUnique.mockResolvedValue({ id: "seo-1", companyId: COMPANY_B });
      const result = await bulkDeleteContent("seo-1", ["content-1"]);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toMatch(/not found/i);
    });
  });

  describe("6. Activity metadata includes both count and skippedCount", () => {
    it("logs content.bulk_deleted with count and skippedCount", async () => {
      mockedPrisma.contentRevision.findMany.mockResolvedValue([{ contentId: "content-2" }]);
      mockedPrisma.content.deleteMany.mockResolvedValue({ count: 1 });

      await bulkDeleteContent("seo-1", ["content-1", "content-2"]);

      expect(mockedLogActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "content.bulk_deleted",
          seoProjectId: "seo-1",
          metadata: { count: 1, skippedCount: 1 },
        })
      );
    });
  });
});

const CONTENT_ID = "content-1";
const SEO_PROJECT_ID = "seo-1";

function makeContentNote(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "note-1",
    authorId: AUTHOR_ID,
    contentId: CONTENT_ID,
    clientId: null,
    leadId: null,
    projectId: null,
    taskId: null,
    seoProjectId: null,
    body: "Original note body",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    deletedAt: null,
    content: { id: CONTENT_ID, seoProject: { id: SEO_PROJECT_ID, companyId: COMPANY_A } },
    ...overrides,
  };
}

const AUTHOR_ID = "note-author-1";
const OTHER_EMPLOYEE_NOTE = { id: "user-2", role: "EMPLOYEE", companyId: COMPANY_A };
const MANAGER_NOTE = { id: "user-3", role: "MANAGER", companyId: COMPANY_A };

describe("updateContentNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.note.findUnique.mockResolvedValue(makeContentNote());
    mockedPrisma.note.update.mockResolvedValue(makeContentNote({ body: "Updated body" }));
  });

  it("1. author successfully edits own note", async () => {
    mockedRequireUser.mockResolvedValue({ id: AUTHOR_ID, role: "EMPLOYEE", companyId: COMPANY_A });
    const result = await updateContentNote({ noteId: "note-1", body: "Updated body" });
    expect(result.success).toBe(true);
  });

  it("3. manager successfully edits another user's note", async () => {
    mockedRequireUser.mockResolvedValue(MANAGER_NOTE);
    const result = await updateContentNote({ noteId: "note-1", body: "By manager" });
    expect(result.success).toBe(true);
  });

  it("5. unauthorized employee cannot edit another user's note", async () => {
    mockedRequireUser.mockResolvedValue(OTHER_EMPLOYEE_NOTE);
    const result = await updateContentNote({ noteId: "note-1", body: "Hijacked" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/permission/i);
    expect(mockedPrisma.note.update).not.toHaveBeenCalled();
  });

  it("7. wrong-tenant note is rejected", async () => {
    mockedPrisma.note.findUnique.mockResolvedValue(
      makeContentNote({ content: { id: CONTENT_ID, seoProject: { id: SEO_PROJECT_ID, companyId: COMPANY_B } } })
    );
    const result = await updateContentNote({ noteId: "note-1", body: "x" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Note not found.");
    expect(mockedPrisma.note.update).not.toHaveBeenCalled();
  });

  it("8. missing note is rejected", async () => {
    mockedPrisma.note.findUnique.mockResolvedValue(null);
    const result = await updateContentNote({ noteId: "missing", body: "x" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Note not found.");
  });

  it("note with no Content relation is rejected", async () => {
    mockedPrisma.note.findUnique.mockResolvedValue(makeContentNote({ contentId: null, content: null }));
    const result = await updateContentNote({ noteId: "note-1", body: "x" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Note not found.");
  });

  it("9. already-deleted note cannot be edited", async () => {
    mockedPrisma.note.findUnique.mockResolvedValue(makeContentNote({ deletedAt: new Date() }));
    const result = await updateContentNote({ noteId: "note-1", body: "x" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/already been deleted/i);
    expect(mockedPrisma.note.update).not.toHaveBeenCalled();
  });

  it("10. empty body is rejected", async () => {
    const result = await updateContentNote({ noteId: "note-1", body: "" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/cannot be empty/i);
    expect(mockedPrisma.note.update).not.toHaveBeenCalled();
  });

  it("11. whitespace-only body is rejected", async () => {
    const result = await updateContentNote({ noteId: "note-1", body: "   " });
    expect(result.success).toBe(false);
    expect(mockedPrisma.note.update).not.toHaveBeenCalled();
  });

  it("12. edit changes only body", async () => {
    await updateContentNote({ noteId: "note-1", body: "  padded  " });
    const [{ data }] = mockedPrisma.note.update.mock.calls[0];
    expect(Object.keys(data)).toEqual(["body"]);
    expect(data.body).toBe("padded");
  });

  it("14. authorId remains unchanged (never included in the update)", async () => {
    await updateContentNote({ noteId: "note-1", body: "Updated body" });
    const [{ data }] = mockedPrisma.note.update.mock.calls[0];
    expect(data).not.toHaveProperty("authorId");
  });

  it("15. contentId remains unchanged (never included in the update)", async () => {
    await updateContentNote({ noteId: "note-1", body: "Updated body" });
    const [{ data }] = mockedPrisma.note.update.mock.calls[0];
    expect(data).not.toHaveProperty("contentId");
  });

  it("16. Activity action is correct, with seoProjectId and contentId set", async () => {
    await updateContentNote({ noteId: "note-1", body: "Updated body" });
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "content.note_updated",
      companyId: COMPANY_A,
      seoProjectId: SEO_PROJECT_ID,
      contentId: CONTENT_ID,
      metadata: { noteId: "note-1" },
    });
  });

  it("17. Activity metadata is exactly { noteId }", async () => {
    await updateContentNote({ noteId: "note-1", body: "Updated body" });
    const [call] = mockedLogActivity.mock.calls[0];
    expect(Object.keys(call.metadata)).toEqual(["noteId"]);
  });

  it("18. note body is not included in Activity metadata", async () => {
    await updateContentNote({ noteId: "note-1", body: "Sensitive text that must not leak" });
    const [call] = mockedLogActivity.mock.calls[0];
    expect(JSON.stringify(call)).not.toContain("Sensitive text");
  });

  it("19. correct revalidatePath is called", async () => {
    await updateContentNote({ noteId: "note-1", body: "Updated body" });
    expect(mockedRevalidatePath).toHaveBeenCalledWith(`/seo/${SEO_PROJECT_ID}/content/${CONTENT_ID}`);
  });

  it("21. does not create a ContentRevision", async () => {
    await updateContentNote({ noteId: "note-1", body: "Updated body" });
    expect(mockedPrisma.contentRevision.create).not.toHaveBeenCalled();
  });

  it("22. never touches the Content row at all", async () => {
    await updateContentNote({ noteId: "note-1", body: "Updated body" });
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
    expect(mockedPrisma.content.findUnique).not.toHaveBeenCalled();
  });
});

describe("deleteContentNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.note.findUnique.mockResolvedValue(makeContentNote());
    mockedPrisma.note.update.mockResolvedValue(makeContentNote({ deletedAt: new Date() }));
  });

  it("2. author successfully deletes own note", async () => {
    mockedRequireUser.mockResolvedValue({ id: AUTHOR_ID, role: "EMPLOYEE", companyId: COMPANY_A });
    const result = await deleteContentNote({ noteId: "note-1" });
    expect(result.success).toBe(true);
  });

  it("4. manager successfully deletes another user's note", async () => {
    mockedRequireUser.mockResolvedValue(MANAGER_NOTE);
    const result = await deleteContentNote({ noteId: "note-1" });
    expect(result.success).toBe(true);
  });

  it("6. unauthorized employee cannot delete another user's note", async () => {
    mockedRequireUser.mockResolvedValue(OTHER_EMPLOYEE_NOTE);
    const result = await deleteContentNote({ noteId: "note-1" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/permission/i);
    expect(mockedPrisma.note.update).not.toHaveBeenCalled();
  });

  it("7b. wrong-tenant note is rejected", async () => {
    mockedPrisma.note.findUnique.mockResolvedValue(
      makeContentNote({ content: { id: CONTENT_ID, seoProject: { id: SEO_PROJECT_ID, companyId: COMPANY_B } } })
    );
    const result = await deleteContentNote({ noteId: "note-1" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Note not found.");
    expect(mockedPrisma.note.update).not.toHaveBeenCalled();
  });

  it("8b. missing note is rejected", async () => {
    mockedPrisma.note.findUnique.mockResolvedValue(null);
    const result = await deleteContentNote({ noteId: "missing" });
    expect(result.success).toBe(false);
  });

  it("13. delete changes only deletedAt", async () => {
    await deleteContentNote({ noteId: "note-1" });
    const [{ data }] = mockedPrisma.note.update.mock.calls[0];
    expect(Object.keys(data)).toEqual(["deletedAt"]);
    expect(data.deletedAt).toBeInstanceOf(Date);
  });

  it("14b. authorId remains unchanged (never included in the update)", async () => {
    await deleteContentNote({ noteId: "note-1" });
    const [{ data }] = mockedPrisma.note.update.mock.calls[0];
    expect(data).not.toHaveProperty("authorId");
  });

  it("15b. contentId remains unchanged (never included in the update)", async () => {
    await deleteContentNote({ noteId: "note-1" });
    const [{ data }] = mockedPrisma.note.update.mock.calls[0];
    expect(data).not.toHaveProperty("contentId");
  });

  it("16b. Activity action is correct, with seoProjectId and contentId set", async () => {
    await deleteContentNote({ noteId: "note-1" });
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "content.note_deleted",
      companyId: COMPANY_A,
      seoProjectId: SEO_PROJECT_ID,
      contentId: CONTENT_ID,
      metadata: { noteId: "note-1" },
    });
  });

  it("17b. Activity metadata is exactly { noteId }", async () => {
    await deleteContentNote({ noteId: "note-1" });
    const [call] = mockedLogActivity.mock.calls[0];
    expect(Object.keys(call.metadata)).toEqual(["noteId"]);
  });

  it("18b. note body is not included in Activity metadata", async () => {
    mockedPrisma.note.findUnique.mockResolvedValue(makeContentNote({ body: "Sensitive text that must not leak" }));
    await deleteContentNote({ noteId: "note-1" });
    const [call] = mockedLogActivity.mock.calls[0];
    expect(JSON.stringify(call)).not.toContain("Sensitive text");
  });

  it("19b. correct revalidatePath is called", async () => {
    await deleteContentNote({ noteId: "note-1" });
    expect(mockedRevalidatePath).toHaveBeenCalledWith(`/seo/${SEO_PROJECT_ID}/content/${CONTENT_ID}`);
  });

  it("21b. does not create a ContentRevision", async () => {
    await deleteContentNote({ noteId: "note-1" });
    expect(mockedPrisma.contentRevision.create).not.toHaveBeenCalled();
  });

  it("22b. never touches the Content row at all", async () => {
    await deleteContentNote({ noteId: "note-1" });
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
    expect(mockedPrisma.content.findUnique).not.toHaveBeenCalled();
  });
});

describe("restoreContentNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.note.findUnique.mockResolvedValue(makeContentNote({ deletedAt: new Date("2026-02-01") }));
    mockedPrisma.note.update.mockResolvedValue(makeContentNote({ deletedAt: null }));
  });

  it("author successfully restores own note", async () => {
    mockedRequireUser.mockResolvedValue({ id: AUTHOR_ID, role: "EMPLOYEE", companyId: COMPANY_A });
    const result = await restoreContentNote({ noteId: "note-1" });
    expect(result.success).toBe(true);
  });

  it("manager successfully restores another user's note", async () => {
    mockedRequireUser.mockResolvedValue(MANAGER_NOTE);
    const result = await restoreContentNote({ noteId: "note-1" });
    expect(result.success).toBe(true);
  });

  it("unauthorized employee cannot restore another user's note", async () => {
    mockedRequireUser.mockResolvedValue(OTHER_EMPLOYEE_NOTE);
    const result = await restoreContentNote({ noteId: "note-1" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/permission/i);
    expect(mockedPrisma.note.update).not.toHaveBeenCalled();
  });

  it("wrong-tenant note is rejected", async () => {
    mockedPrisma.note.findUnique.mockResolvedValue(
      makeContentNote({ deletedAt: new Date(), content: { id: CONTENT_ID, seoProject: { id: SEO_PROJECT_ID, companyId: COMPANY_B } } })
    );
    const result = await restoreContentNote({ noteId: "note-1" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Note not found.");
    expect(mockedPrisma.note.update).not.toHaveBeenCalled();
  });

  it("missing note is rejected", async () => {
    mockedPrisma.note.findUnique.mockResolvedValue(null);
    const result = await restoreContentNote({ noteId: "missing" });
    expect(result.success).toBe(false);
  });

  it("rejects restoring a note that isn't deleted", async () => {
    mockedPrisma.note.findUnique.mockResolvedValue(makeContentNote({ deletedAt: null }));
    const result = await restoreContentNote({ noteId: "note-1" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/not deleted/i);
    expect(mockedPrisma.note.update).not.toHaveBeenCalled();
  });

  it("restore changes only deletedAt, to null", async () => {
    await restoreContentNote({ noteId: "note-1" });
    const [{ data }] = mockedPrisma.note.update.mock.calls[0];
    expect(data).toEqual({ deletedAt: null });
  });

  it("authorId remains unchanged (never included in the update)", async () => {
    await restoreContentNote({ noteId: "note-1" });
    const [{ data }] = mockedPrisma.note.update.mock.calls[0];
    expect(data).not.toHaveProperty("authorId");
  });

  it("contentId remains unchanged (never included in the update)", async () => {
    await restoreContentNote({ noteId: "note-1" });
    const [{ data }] = mockedPrisma.note.update.mock.calls[0];
    expect(data).not.toHaveProperty("contentId");
  });

  it("Activity action is correct, with seoProjectId and contentId set", async () => {
    await restoreContentNote({ noteId: "note-1" });
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "content.note_restored",
      companyId: COMPANY_A,
      seoProjectId: SEO_PROJECT_ID,
      contentId: CONTENT_ID,
      metadata: { noteId: "note-1" },
    });
  });

  it("Activity metadata is exactly { noteId }", async () => {
    await restoreContentNote({ noteId: "note-1" });
    const [call] = mockedLogActivity.mock.calls[0];
    expect(Object.keys(call.metadata)).toEqual(["noteId"]);
  });

  it("note body is not included in Activity metadata", async () => {
    mockedPrisma.note.findUnique.mockResolvedValue(
      makeContentNote({ deletedAt: new Date(), body: "Sensitive text that must not leak" })
    );
    await restoreContentNote({ noteId: "note-1" });
    const [call] = mockedLogActivity.mock.calls[0];
    expect(JSON.stringify(call)).not.toContain("Sensitive text");
  });

  it("correct revalidatePath is called", async () => {
    await restoreContentNote({ noteId: "note-1" });
    expect(mockedRevalidatePath).toHaveBeenCalledWith(`/seo/${SEO_PROJECT_ID}/content/${CONTENT_ID}`);
  });

  it("does not create a ContentRevision", async () => {
    await restoreContentNote({ noteId: "note-1" });
    expect(mockedPrisma.contentRevision.create).not.toHaveBeenCalled();
  });

  it("never touches the Content row at all", async () => {
    await restoreContentNote({ noteId: "note-1" });
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
    expect(mockedPrisma.content.findUnique).not.toHaveBeenCalled();
  });
});

describe("createContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(SEO_PROJECT);
    mockedPrisma.content.create.mockResolvedValue({ id: "content-new", title: "New Article" });
  });

  it("1. denies an EMPLOYEE without creating any Content", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await createContent("seo-1", VALID_CONTENT_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to create content.");
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("2. rejects when the SEO project does not exist", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(null);
    const result = await createContent("seo-1", VALID_CONTENT_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("SEO project not found.");
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("3. rejects when the SEO project belongs to a different company", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, companyId: COMPANY_B });
    const result = await createContent("seo-1", VALID_CONTENT_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("SEO project not found.");
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("4. rejects invalid input via the real schema, without creating any Content", async () => {
    const result = await createContent("seo-1", { ...VALID_CONTENT_INPUT, title: "A" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Title must be at least 2 characters");
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("5. creates the Content with the exact field mapping when every optional field is blank", async () => {
    await createContent("seo-1", VALID_CONTENT_INPUT);
    expect(mockedPrisma.content.create).toHaveBeenCalledWith({
      data: {
        seoProjectId: "seo-1",
        authorId: null,
        title: "New Article",
        url: null,
        status: "DRAFT",
        publishedAt: null,
        body: null,
        keywords: undefined,
      },
    });
  });

  it("6. omitted keywordIds produces keywords: undefined (no connect at all)", async () => {
    await createContent("seo-1", { ...VALID_CONTENT_INPUT, keywordIds: undefined });
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.keywords).toBeUndefined();
  });

  it("7. [documents real behavior] an empty keywordIds array still produces keywords: { connect: [] }, not undefined", async () => {
    await createContent("seo-1", { ...VALID_CONTENT_INPUT, keywordIds: [] });
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.keywords).toEqual({ connect: [] });
  });

  it("8. provided keywordIds connect to exactly those keyword ids", async () => {
    await createContent("seo-1", { ...VALID_CONTENT_INPUT, keywordIds: ["kw-1", "kw-2"] });
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.keywords).toEqual({ connect: [{ id: "kw-1" }, { id: "kw-2" }] });
  });

  it("9. converts a provided publishedAt string to a real Date", async () => {
    await createContent("seo-1", { ...VALID_CONTENT_INPUT, publishedAt: "2026-03-01" });
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.publishedAt).toEqual(new Date("2026-03-01"));
  });

  it("10. logs content.created with the exact actor/company/project/content ids and metadata", async () => {
    await createContent("seo-1", VALID_CONTENT_INPUT);
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "content.created",
      companyId: COMPANY_A,
      seoProjectId: "seo-1",
      contentId: "content-new",
      metadata: { title: "New Article" },
    });
  });

  it("11. revalidates the content list and the SEO project detail path", async () => {
    await createContent("seo-1", VALID_CONTENT_INPUT);
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/seo/seo-1/content");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/seo/seo-1");
  });

  it("12. returns the id of the newly created Content", async () => {
    const result = await createContent("seo-1", VALID_CONTENT_INPUT);
    expect(result).toEqual({ success: true, data: { id: "content-new" } });
  });

  it("13. [characterization — documents current production behavior] an authorId belonging to another company is accepted without any tenant validation, because none exists in production", async () => {
    const result = await createContent("seo-1", { ...VALID_CONTENT_INPUT, authorId: "author-from-another-company" });
    expect(result.success).toBe(true);
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.authorId).toBe("author-from-another-company");
  });
});

describe("advanceContentStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
  });

  it("1. denies an EMPLOYEE without mutating", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(makeExistingContent({ status: "DRAFT" }));
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await advanceContentStatus("content-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to change content status.");
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
  });

  it("2. rejects when the Content does not exist", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(null);
    const result = await advanceContentStatus("content-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Content not found.");
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
  });

  it("3. rejects when the Content belongs to a different company", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(makeExistingContent({ seoProject: { id: "seo-1", companyId: COMPANY_B } }));
    const result = await advanceContentStatus("content-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Content not found.");
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
  });

  it("4. advances DRAFT to IN_REVIEW, preserving a null publishedAt", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(makeExistingContent({ status: "DRAFT", publishedAt: null }));
    await advanceContentStatus("content-1");
    expect(mockedPrisma.content.update).toHaveBeenCalledWith({
      where: { id: "content-1" },
      data: { status: "IN_REVIEW", publishedAt: null },
    });
  });

  it("5. advances IN_REVIEW to APPROVED, preserving a null publishedAt", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(makeExistingContent({ status: "IN_REVIEW", publishedAt: null }));
    await advanceContentStatus("content-1");
    expect(mockedPrisma.content.update).toHaveBeenCalledWith({
      where: { id: "content-1" },
      data: { status: "APPROVED", publishedAt: null },
    });
  });

  it("6. advancing APPROVED to PUBLISHED stamps publishedAt with a fresh Date", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(makeExistingContent({ status: "APPROVED", publishedAt: null }));
    await advanceContentStatus("content-1");
    const [{ data }] = mockedPrisma.content.update.mock.calls[0];
    expect(data.status).toBe("PUBLISHED");
    expect(data.publishedAt).toBeInstanceOf(Date);
  });

  it("7. advancing PUBLISHED to ARCHIVED preserves the existing publishedAt exactly, without re-stamping", async () => {
    const originalPublishedAt = new Date("2026-01-15");
    mockedPrisma.content.findUnique.mockResolvedValue(makeExistingContent({ status: "PUBLISHED", publishedAt: originalPublishedAt }));
    await advanceContentStatus("content-1");
    expect(mockedPrisma.content.update).toHaveBeenCalledWith({
      where: { id: "content-1" },
      data: { status: "ARCHIVED", publishedAt: originalPublishedAt },
    });
  });

  it("8. rejects advancing past ARCHIVED — the final stage — without mutating or logging activity", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(makeExistingContent({ status: "ARCHIVED" }));
    const result = await advanceContentStatus("content-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("This content is already at its final stage.");
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
    expect(mockedLogActivity).not.toHaveBeenCalled();
  });

  it("9. logs content.status_advanced with the exact from/to metadata", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(makeExistingContent({ status: "DRAFT", publishedAt: null }));
    await advanceContentStatus("content-1");
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "content.status_advanced",
      companyId: COMPANY_A,
      seoProjectId: "seo-1",
      contentId: "content-1",
      metadata: { from: "DRAFT", to: "IN_REVIEW" },
    });
  });

  it("10. revalidates the content list and the content detail path", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(makeExistingContent({ status: "DRAFT", publishedAt: null }));
    await advanceContentStatus("content-1");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/seo/seo-1/content");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/seo/seo-1/content/content-1");
  });

  it("11. returns a plain success result", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(makeExistingContent({ status: "DRAFT", publishedAt: null }));
    const result = await advanceContentStatus("content-1");
    expect(result).toEqual({ success: true, data: undefined });
  });
});

describe("archiveContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.content.findUnique.mockResolvedValue(makeExistingContent());
  });

  it("1. denies an EMPLOYEE without mutating", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await archiveContent("content-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to archive content.");
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
  });

  it("2. rejects when the Content does not exist", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(null);
    const result = await archiveContent("content-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Content not found.");
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
  });

  it("3. rejects when the Content belongs to a different company", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(makeExistingContent({ seoProject: { id: "seo-1", companyId: COMPANY_B } }));
    const result = await archiveContent("content-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Content not found.");
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
  });

  it("4. sets deletedAt to a Date instance with the exact where clause", async () => {
    await archiveContent("content-1");
    const [{ where, data }] = mockedPrisma.content.update.mock.calls[0];
    expect(where).toEqual({ id: "content-1" });
    expect(Object.keys(data)).toEqual(["deletedAt"]);
    expect(data.deletedAt).toBeInstanceOf(Date);
  });

  it("5. logs content.archived with no metadata", async () => {
    await archiveContent("content-1");
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "content.archived",
      companyId: COMPANY_A,
      seoProjectId: "seo-1",
      contentId: "content-1",
    });
  });

  it("6. revalidates only the content list", async () => {
    await archiveContent("content-1");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/seo/seo-1/content");
    expect(mockedRevalidatePath).toHaveBeenCalledTimes(1);
  });

  it("7. returns a plain success result", async () => {
    const result = await archiveContent("content-1");
    expect(result).toEqual({ success: true, data: undefined });
  });
});

describe("restoreContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.content.findUnique.mockResolvedValue(makeExistingContent());
  });

  it("1. denies an EMPLOYEE without mutating", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await restoreContent("content-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to restore content.");
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
  });

  it("2. rejects when the Content does not exist", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(null);
    const result = await restoreContent("content-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Content not found.");
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
  });

  it("3. rejects when the Content belongs to a different company", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(makeExistingContent({ seoProject: { id: "seo-1", companyId: COMPANY_B } }));
    const result = await restoreContent("content-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Content not found.");
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
  });

  it("4. sets deletedAt to exactly null with the exact where clause", async () => {
    await restoreContent("content-1");
    expect(mockedPrisma.content.update).toHaveBeenCalledWith({ where: { id: "content-1" }, data: { deletedAt: null } });
  });

  it("5. logs content.restored with no metadata", async () => {
    await restoreContent("content-1");
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "content.restored",
      companyId: COMPANY_A,
      seoProjectId: "seo-1",
      contentId: "content-1",
    });
  });

  it("6. revalidates only the content list", async () => {
    await restoreContent("content-1");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/seo/seo-1/content");
    expect(mockedRevalidatePath).toHaveBeenCalledTimes(1);
  });

  it("7. returns a plain success result", async () => {
    const result = await restoreContent("content-1");
    expect(result).toEqual({ success: true, data: undefined });
  });
});

describe("addContentNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    mockedPrisma.content.findUnique.mockResolvedValue(makeExistingContent({ title: "Storage Guide" }));
    mockedPrisma.note.create.mockResolvedValue({ id: "note-new" });
    mockedPrisma.user.findMany.mockResolvedValue([]);
  });

  it("1. rejects when the Content does not exist", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(null);
    const result = await addContentNote("content-1", "A note");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Content not found.");
    expect(mockedPrisma.note.create).not.toHaveBeenCalled();
  });

  it("2. rejects when the Content belongs to a different company", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(makeExistingContent({ seoProject: { id: "seo-1", companyId: COMPANY_B } }));
    const result = await addContentNote("content-1", "A note");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Content not found.");
    expect(mockedPrisma.note.create).not.toHaveBeenCalled();
  });

  it("3. rejects a whitespace-only body without creating a note", async () => {
    const result = await addContentNote("content-1", "    ");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Note cannot be empty.");
    expect(mockedPrisma.note.create).not.toHaveBeenCalled();
  });

  it("4. succeeds for a plain EMPLOYEE (no role gate — self-service)", async () => {
    const result = await addContentNote("content-1", "A note");
    expect(result.success).toBe(true);
  });

  it("5. creates the note with the trimmed body and the actor/content association", async () => {
    await addContentNote("content-1", "  padded note  ");
    expect(mockedPrisma.note.create).toHaveBeenCalledWith({
      data: { authorId: EMPLOYEE.id, contentId: "content-1", body: "padded note" },
    });
  });

  it("6. logs content.note_added with no metadata", async () => {
    await addContentNote("content-1", "A note");
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: EMPLOYEE.id,
      action: "content.note_added",
      companyId: COMPANY_A,
      seoProjectId: "seo-1",
      contentId: "content-1",
    });
  });

  it("7. revalidates only the content detail path", async () => {
    await addContentNote("content-1", "A note");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/seo/seo-1/content/content-1");
    expect(mockedRevalidatePath).toHaveBeenCalledTimes(1);
  });

  it("8. zero mentions in the body sends zero notifications", async () => {
    mockedPrisma.user.findMany.mockResolvedValue([{ id: "user-9", firstName: "Sam" }]);
    await addContentNote("content-1", "No mentions here");
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });

  it("9. one real @mention sends exactly one notification, quoting the content's own title", async () => {
    mockedPrisma.user.findMany.mockResolvedValue([{ id: "user-9", firstName: "Sam" }]);
    await addContentNote("content-1", "Great work @Sam");
    expect(mockedPrisma.user.findMany).toHaveBeenCalledWith({
      where: { companyId: COMPANY_A, deletedAt: null },
      select: { id: true, firstName: true },
    });
    expect(mockedCreateNotification).toHaveBeenCalledTimes(1);
    expect(mockedCreateNotification).toHaveBeenCalledWith({
      userId: "user-9",
      type: "COMMENT_MENTION",
      message: `${EMPLOYEE.firstName} mentioned you in a note on "Storage Guide"`,
      link: "/seo/seo-1/content/content-1",
    });
  });

  it("10. multiple @mentions send exactly one notification per mentioned user, to the correct recipients", async () => {
    mockedPrisma.user.findMany.mockResolvedValue([
      { id: "user-9", firstName: "Sam" },
      { id: "user-10", firstName: "Jordan" },
    ]);
    await addContentNote("content-1", "cc @Sam and @Jordan");
    expect(mockedCreateNotification).toHaveBeenCalledTimes(2);
    const recipients = mockedCreateNotification.mock.calls.map((call: unknown[]) => (call[0] as { userId: string }).userId);
    expect(recipients.sort()).toEqual(["user-10", "user-9"]);
  });

  it("11. never notifies the author for a self-mention", async () => {
    mockedPrisma.user.findMany.mockResolvedValue([{ id: EMPLOYEE.id, firstName: "Alex" }]);
    await addContentNote("content-1", "Reminding myself @Alex");
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });

  it("12. sends no notifications when the request is rejected", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(null);
    await addContentNote("content-1", "Great work @Sam");
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });
});

describe("bulkArchiveContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(SEO_PROJECT);
    mockedPrisma.content.findMany.mockResolvedValue([{ id: "c1" }, { id: "c2" }]);
    mockedPrisma.content.updateMany.mockResolvedValue({ count: 2 });
  });

  it("1. denies an EMPLOYEE without ever querying ownership or mutating", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await bulkArchiveContent("seo-1", ["c1", "c2"]);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to archive content.");
    expect(mockedPrisma.sEOProject.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.content.updateMany).not.toHaveBeenCalled();
  });

  it("2. rejects when the SEO project does not exist — ownership filtering yields nothing, no mutation", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(null);
    const result = await bulkArchiveContent("seo-1", ["c1", "c2"]);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("No matching content found.");
    expect(mockedPrisma.content.updateMany).not.toHaveBeenCalled();
    expect(mockedLogActivity).not.toHaveBeenCalled();
  });

  it("3. rejects when the SEO project belongs to a different company, without mutating", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, companyId: COMPANY_B });
    const result = await bulkArchiveContent("seo-1", ["c1", "c2"]);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("No matching content found.");
    expect(mockedPrisma.content.updateMany).not.toHaveBeenCalled();
  });

  it("4. queries ownership with the exact ids/seoProjectId scoping", async () => {
    await bulkArchiveContent("seo-1", ["c1", "c2"]);
    expect(mockedPrisma.content.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["c1", "c2"] }, seoProjectId: "seo-1" },
      select: { id: true },
    });
  });

  it("5. all-owned ids are all passed through to updateMany", async () => {
    mockedPrisma.content.findMany.mockResolvedValue([{ id: "c1" }, { id: "c2" }]);
    await bulkArchiveContent("seo-1", ["c1", "c2"]);
    expect(mockedPrisma.content.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["c1", "c2"] } },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it("6. [CRITICAL] a mixed owned+foreign batch is FILTERED to only the owned subset — the foreign id never reaches updateMany", async () => {
    mockedPrisma.content.findMany.mockResolvedValue([{ id: "c1" }]);
    await bulkArchiveContent("seo-1", ["c1", "foreign-id"]);
    expect(mockedPrisma.content.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["c1"] } },
      data: { deletedAt: expect.any(Date) },
    });
    const [{ where }] = mockedPrisma.content.updateMany.mock.calls[0];
    expect(where.id.in).not.toContain("foreign-id");
  });

  it("7. an all-foreign batch resolves zero owned ids and rejects without mutating", async () => {
    mockedPrisma.content.findMany.mockResolvedValue([]);
    const result = await bulkArchiveContent("seo-1", ["foreign-1", "foreign-2"]);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("No matching content found.");
    expect(mockedPrisma.content.updateMany).not.toHaveBeenCalled();
    expect(mockedLogActivity).not.toHaveBeenCalled();
  });

  it("8. logs content.bulk_archived with the exact affected count", async () => {
    mockedPrisma.content.updateMany.mockResolvedValue({ count: 2 });
    await bulkArchiveContent("seo-1", ["c1", "c2"]);
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "content.bulk_archived",
      companyId: COMPANY_A,
      seoProjectId: "seo-1",
      metadata: { count: 2 },
    });
  });

  it("9. revalidates only the content list", async () => {
    await bulkArchiveContent("seo-1", ["c1", "c2"]);
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/seo/seo-1/content");
    expect(mockedRevalidatePath).toHaveBeenCalledTimes(1);
  });

  it("10. returns the exact affected count from updateMany", async () => {
    mockedPrisma.content.updateMany.mockResolvedValue({ count: 2 });
    const result = await bulkArchiveContent("seo-1", ["c1", "c2"]);
    expect(result).toEqual({ success: true, data: { count: 2 } });
  });
});

describe("bulkRestoreContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(SEO_PROJECT);
    mockedPrisma.content.findMany.mockResolvedValue([{ id: "c1" }, { id: "c2" }]);
    mockedPrisma.content.updateMany.mockResolvedValue({ count: 2 });
  });

  it("1. denies an EMPLOYEE without mutating", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await bulkRestoreContent("seo-1", ["c1", "c2"]);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to restore content.");
    expect(mockedPrisma.content.updateMany).not.toHaveBeenCalled();
  });

  it("2. [CRITICAL] a mixed owned+foreign batch is FILTERED — only owned ids reach updateMany", async () => {
    mockedPrisma.content.findMany.mockResolvedValue([{ id: "c1" }]);
    await bulkRestoreContent("seo-1", ["c1", "foreign-id"]);
    expect(mockedPrisma.content.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["c1"] } },
      data: { deletedAt: null },
    });
  });

  it("3. an all-foreign batch rejects without mutating", async () => {
    mockedPrisma.content.findMany.mockResolvedValue([]);
    const result = await bulkRestoreContent("seo-1", ["foreign-1"]);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("No matching content found.");
    expect(mockedPrisma.content.updateMany).not.toHaveBeenCalled();
  });

  it("4. restores with deletedAt: null exactly, for the owned ids", async () => {
    await bulkRestoreContent("seo-1", ["c1", "c2"]);
    expect(mockedPrisma.content.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["c1", "c2"] } },
      data: { deletedAt: null },
    });
  });

  it("5. logs content.bulk_restored with the exact affected count", async () => {
    await bulkRestoreContent("seo-1", ["c1", "c2"]);
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "content.bulk_restored",
      companyId: COMPANY_A,
      seoProjectId: "seo-1",
      metadata: { count: 2 },
    });
  });

  it("6. revalidates only the content list", async () => {
    await bulkRestoreContent("seo-1", ["c1", "c2"]);
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/seo/seo-1/content");
    expect(mockedRevalidatePath).toHaveBeenCalledTimes(1);
  });

  it("7. returns the exact affected count", async () => {
    const result = await bulkRestoreContent("seo-1", ["c1", "c2"]);
    expect(result).toEqual({ success: true, data: { count: 2 } });
  });
});

describe("bulkPublishContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(SEO_PROJECT);
    mockedPrisma.content.findMany.mockResolvedValue([{ id: "c1" }, { id: "c2" }]);
    mockedPrisma.content.updateMany.mockResolvedValue({ count: 2 });
  });

  it("1. denies an EMPLOYEE without mutating", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await bulkPublishContent("seo-1", ["c1", "c2"]);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to publish content.");
    expect(mockedPrisma.content.updateMany).not.toHaveBeenCalled();
  });

  it("2. [CRITICAL] a mixed owned+foreign batch is FILTERED — only owned ids reach updateMany", async () => {
    mockedPrisma.content.findMany.mockResolvedValue([{ id: "c1" }]);
    await bulkPublishContent("seo-1", ["c1", "foreign-id"]);
    const [{ where }] = mockedPrisma.content.updateMany.mock.calls[0];
    expect(where).toEqual({ id: { in: ["c1"] } });
  });

  it("3. an all-foreign batch rejects without mutating", async () => {
    mockedPrisma.content.findMany.mockResolvedValue([]);
    const result = await bulkPublishContent("seo-1", ["foreign-1"]);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("No matching content found.");
    expect(mockedPrisma.content.updateMany).not.toHaveBeenCalled();
  });

  it("4. publishes with status: PUBLISHED and a fresh publishedAt Date, for the owned ids", async () => {
    await bulkPublishContent("seo-1", ["c1", "c2"]);
    const [{ where, data }] = mockedPrisma.content.updateMany.mock.calls[0];
    expect(where).toEqual({ id: { in: ["c1", "c2"] } });
    expect(data.status).toBe("PUBLISHED");
    expect(data.publishedAt).toBeInstanceOf(Date);
  });

  it("5. logs content.bulk_published with the exact affected count", async () => {
    await bulkPublishContent("seo-1", ["c1", "c2"]);
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "content.bulk_published",
      companyId: COMPANY_A,
      seoProjectId: "seo-1",
      metadata: { count: 2 },
    });
  });

  it("6. revalidates only the content list", async () => {
    await bulkPublishContent("seo-1", ["c1", "c2"]);
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/seo/seo-1/content");
    expect(mockedRevalidatePath).toHaveBeenCalledTimes(1);
  });

  it("7. returns the exact affected count", async () => {
    const result = await bulkPublishContent("seo-1", ["c1", "c2"]);
    expect(result).toEqual({ success: true, data: { count: 2 } });
  });
});

describe("importContentCsv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(SEO_PROJECT);
    mockedPrisma.content.create.mockResolvedValue({ id: "content-new" });
  });

  it("1. denies an EMPLOYEE without reading the file", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const formData = makeFormDataWithFile("title,url,status\nGood Title,,DRAFT");
    const result = await importContentCsv("seo-1", formData);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to import content.");
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("2. rejects when the SEO project does not exist", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(null);
    const formData = makeFormDataWithFile("title,url,status\nGood Title,,DRAFT");
    const result = await importContentCsv("seo-1", formData);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("SEO project not found.");
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("3. rejects when the SEO project belongs to a different company", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, companyId: COMPANY_B });
    const formData = makeFormDataWithFile("title,url,status\nGood Title,,DRAFT");
    const result = await importContentCsv("seo-1", formData);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("SEO project not found.");
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("4. rejects when no file is provided", async () => {
    const formData = new FormData();
    const result = await importContentCsv("seo-1", formData);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Choose a CSV file first.");
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("5. rejects an empty (zero-byte) file", async () => {
    const formData = makeFormDataWithFile("");
    const result = await importContentCsv("seo-1", formData);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Choose a CSV file first.");
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("6. rejects a header-only CSV with no data rows (real parseCsv)", async () => {
    const formData = makeFormDataWithFile("title,url,status");
    const result = await importContentCsv("seo-1", formData);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("The CSV file has no data rows.");
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("7. imports a single valid row with the exact Content.create payload", async () => {
    const formData = makeFormDataWithFile("title,url,status\nFirst Article,https://example.com/a,APPROVED");
    const result = await importContentCsv("seo-1", formData);
    expect(mockedPrisma.content.create).toHaveBeenCalledWith({
      data: { seoProjectId: "seo-1", title: "First Article", url: "https://example.com/a", status: "APPROVED" },
    });
    expect(result).toEqual({ success: true, data: { created: 1, errors: [] } });
  });

  it("8. imports multiple valid rows, incrementing created for each", async () => {
    const formData = makeFormDataWithFile(
      "title,url,status\nFirst Article,,DRAFT\nSecond Article,,APPROVED\nThird Article,,PUBLISHED"
    );
    const result = await importContentCsv("seo-1", formData);
    expect(mockedPrisma.content.create).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ success: true, data: { created: 3, errors: [] } });
  });

  it("9. a blank status column defaults to DRAFT via the real schema transform", async () => {
    const formData = makeFormDataWithFile("title,url,status\nNo Status Given,,");
    await importContentCsv("seo-1", formData);
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.status).toBe("DRAFT");
  });

  it("10. an invalid row (title too short) is rejected by the real schema and reported with its row number, without creating anything", async () => {
    const formData = makeFormDataWithFile("title,url,status\nA,,DRAFT");
    const result = await importContentCsv("seo-1", formData);
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toBe(0);
      expect(result.data.errors).toEqual([{ row: 2, message: "String must contain at least 2 character(s)" }]);
    }
  });

  it("11. [CRITICAL] an invalid row does NOT abort the import — valid rows before and after it still get created, with correct 1-based+header row numbering", async () => {
    const formData = makeFormDataWithFile(
      "title,url,status\nGood Title One,,DRAFT\nA,,DRAFT\nGood Title Two,,APPROVED"
    );
    const result = await importContentCsv("seo-1", formData);
    expect(mockedPrisma.content.create).toHaveBeenCalledTimes(2);
    expect(mockedPrisma.content.create).toHaveBeenNthCalledWith(1, {
      data: { seoProjectId: "seo-1", title: "Good Title One", url: null, status: "DRAFT" },
    });
    expect(mockedPrisma.content.create).toHaveBeenNthCalledWith(2, {
      data: { seoProjectId: "seo-1", title: "Good Title Two", url: null, status: "APPROVED" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toBe(2);
      expect(result.data.errors).toHaveLength(1);
      expect(result.data.errors[0].row).toBe(3);
    }
  });

  it("12. [CRITICAL] a per-row Prisma create failure is caught and reported with the production fallback message, without aborting subsequent rows", async () => {
    mockedPrisma.content.create
      .mockResolvedValueOnce({ id: "content-1" })
      .mockRejectedValueOnce(new Error("simulated DB failure"))
      .mockResolvedValueOnce({ id: "content-3" });
    const formData = makeFormDataWithFile(
      "title,url,status\nFirst Article,,DRAFT\nSecond Article,,DRAFT\nThird Article,,DRAFT"
    );
    const result = await importContentCsv("seo-1", formData);
    expect(mockedPrisma.content.create).toHaveBeenCalledTimes(3);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toBe(2);
      expect(result.data.errors).toEqual([{ row: 3, message: "Failed to import this row" }]);
    }
  });

  it("13. logs content.csv_imported with the exact created/errorCount metadata", async () => {
    const formData = makeFormDataWithFile("title,url,status\nGood Title,,DRAFT\nA,,DRAFT");
    await importContentCsv("seo-1", formData);
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "content.csv_imported",
      companyId: COMPANY_A,
      seoProjectId: "seo-1",
      metadata: { created: 1, errorCount: 1 },
    });
  });

  it("14. revalidates only the content list", async () => {
    const formData = makeFormDataWithFile("title,url,status\nGood Title,,DRAFT");
    await importContentCsv("seo-1", formData);
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/seo/seo-1/content");
    expect(mockedRevalidatePath).toHaveBeenCalledTimes(1);
  });

  it("15. rejected requests (bad auth/project/file) never log activity or revalidate", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const formData = makeFormDataWithFile("title,url,status\nGood Title,,DRAFT");
    await importContentCsv("seo-1", formData);
    expect(mockedLogActivity).not.toHaveBeenCalled();
    expect(mockedRevalidatePath).not.toHaveBeenCalled();
  });
});
