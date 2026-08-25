import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/features/notifications/services/mention.service", () => ({ extractMentionedUserIds: vi.fn().mockResolvedValue([]) }));
vi.mock("@/features/notifications/services/notification.service", () => ({ createNotification: vi.fn() }));

type MockPrisma = {
  content: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> };
  contentRevision: { count: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  note: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  sEOProject: { findUnique: ReturnType<typeof vi.fn> };
  $queryRaw: ReturnType<typeof vi.fn>;
  $transaction: ReturnType<typeof vi.fn>;
};

function createMockPrisma(): MockPrisma {
  const prisma = {
    content: { findUnique: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
    contentRevision: {
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({ id: "revision-1" }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    note: { findUnique: vi.fn(), update: vi.fn() },
    sEOProject: { findUnique: vi.fn() },
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
import { bulkDeleteContent, deleteContentNote, updateContent, updateContentNote } from "@/features/seo/actions/content.actions";
import type { ContentInput } from "@/features/seo/schemas/content.schema";

const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedLogActivity = logActivity as unknown as ReturnType<typeof vi.fn>;
const mockedRevalidatePath = revalidatePath as unknown as ReturnType<typeof vi.fn>;
const mockedPrisma = prisma as unknown as MockPrisma;

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";
const MANAGER = { id: "user-1", role: "MANAGER", companyId: COMPANY_A };
const EMPLOYEE = { id: "user-2", role: "EMPLOYEE", companyId: COMPANY_A };

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
