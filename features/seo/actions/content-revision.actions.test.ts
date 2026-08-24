import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));

type MockPrisma = {
  content: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  contentRevision: { findUnique: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  $queryRaw: ReturnType<typeof vi.fn>;
  $transaction: ReturnType<typeof vi.fn>;
};

function createMockPrisma(): MockPrisma {
  const prisma = {
    content: { findUnique: vi.fn(), update: vi.fn() },
    contentRevision: { findUnique: vi.fn(), count: vi.fn().mockResolvedValue(0), create: vi.fn() },
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
import { prisma } from "@/lib/prisma";
import { restoreContentRevisionAction } from "@/features/seo/actions/content-revision.actions";

const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedLogActivity = logActivity as unknown as ReturnType<typeof vi.fn>;
const mockedPrisma = prisma as unknown as MockPrisma;

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";
const MANAGER = { id: "user-1", role: "MANAGER", companyId: COMPANY_A };
const EMPLOYEE = { id: "user-2", role: "EMPLOYEE", companyId: COMPANY_A };

function makeContent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "content-1",
    title: "Current Title",
    url: "https://example.com/current",
    status: "APPROVED",
    publishedAt: new Date("2026-01-01"),
    authorId: "author-1",
    metaTitle: "Current Meta Title",
    metaDescription: "Current Meta Description",
    body: "Current body",
    deletedAt: null,
    seoProject: { id: "seo-1", companyId: COMPANY_A },
    ...overrides,
  };
}

function makeRevision(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "revision-old",
    contentId: "content-1",
    companyId: COMPANY_A,
    revisionNumber: 1,
    title: "Old Title",
    metaTitle: "Old Meta Title",
    metaDescription: "Old Meta Description",
    body: "Old body",
    changeSource: "MANUAL_EDIT",
    createdByUserId: "user-1",
    createdAt: new Date("2025-01-01"),
    ...overrides,
  };
}

const INPUT = { contentId: "content-1", revisionId: "revision-old" };

describe("restoreContentRevisionAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.content.findUnique.mockResolvedValue(makeContent());
    mockedPrisma.contentRevision.findUnique.mockResolvedValue(makeRevision());
    mockedPrisma.contentRevision.count.mockResolvedValue(3);
    mockedPrisma.contentRevision.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "revision-new",
      ...data,
    }));
    mockedPrisma.content.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...makeContent(),
      ...data,
    }));
  });

  describe("1 & 2. successful restore replaces exactly the four tracked fields", () => {
    it("applies the selected revision's title/metaTitle/metaDescription/body", async () => {
      const result = await restoreContentRevisionAction(INPUT);

      expect(result.success).toBe(true);
      expect(mockedPrisma.content.update).toHaveBeenCalledWith({
        where: { id: "content-1" },
        data: {
          title: "Old Title",
          metaTitle: "Old Meta Title",
          metaDescription: "Old Meta Description",
          body: "Old body",
        },
      });
    });
  });

  describe("3-7. lifecycle and non-tracked fields are never touched", () => {
    it("never includes status, publishedAt, url, keywords, or authorId in the Content update's data", async () => {
      await restoreContentRevisionAction(INPUT);

      const [{ data }] = mockedPrisma.content.update.mock.calls[0];
      expect(data).not.toHaveProperty("status");
      expect(data).not.toHaveProperty("publishedAt");
      expect(data).not.toHaveProperty("url");
      expect(data).not.toHaveProperty("keywords");
      expect(data).not.toHaveProperty("authorId");
      expect(data).not.toHaveProperty("deletedAt");
    });
  });

  it("8. never touches any publishing-related model — no publishingJob/contentPublication mock exists to call, so any attempt would throw", async () => {
    const result = await restoreContentRevisionAction(INPUT);
    expect(result.success).toBe(true);
    // Implicit: if the action tried to call prisma.publishingJob or
    // prisma.contentPublication, the mock (which defines neither) would
    // throw "is not a function", failing this test.
  });

  describe("9. cross-company revision cannot be restored", () => {
    it("rejects a revision whose companyId differs from the actor's, even if contentId matches", async () => {
      mockedPrisma.contentRevision.findUnique.mockResolvedValue(makeRevision({ companyId: COMPANY_B }));

      const result = await restoreContentRevisionAction(INPUT);

      expect(result.success).toBe(false);
      expect(mockedPrisma.content.update).not.toHaveBeenCalled();
      expect(mockedPrisma.contentRevision.create).not.toHaveBeenCalled();
    });

    it("rejects when the Content itself belongs to a different company", async () => {
      mockedPrisma.content.findUnique.mockResolvedValue(makeContent({ seoProject: { id: "seo-1", companyId: COMPANY_B } }));

      const result = await restoreContentRevisionAction(INPUT);

      expect(result.success).toBe(false);
      expect(mockedPrisma.content.update).not.toHaveBeenCalled();
    });
  });

  describe("10. revision belonging to another Content record cannot be restored", () => {
    it("rejects a revision whose contentId differs from the requested content, even within the same company", async () => {
      mockedPrisma.contentRevision.findUnique.mockResolvedValue(makeRevision({ contentId: "content-other" }));

      const result = await restoreContentRevisionAction(INPUT);

      expect(result.success).toBe(false);
      expect(mockedPrisma.content.update).not.toHaveBeenCalled();
    });
  });

  describe("11. unauthorized user cannot restore", () => {
    it("denies an EMPLOYEE", async () => {
      mockedRequireUser.mockResolvedValue(EMPLOYEE);

      const result = await restoreContentRevisionAction(INPUT);

      expect(result.success).toBe(false);
      expect(mockedPrisma.content.findUnique).not.toHaveBeenCalled();
      expect(mockedPrisma.content.update).not.toHaveBeenCalled();
    });
  });

  describe("12. nonexistent revision", () => {
    it("rejects when the revision id does not exist at all", async () => {
      mockedPrisma.contentRevision.findUnique.mockResolvedValue(null);

      const result = await restoreContentRevisionAction(INPUT);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toBe("Revision not found.");
      expect(mockedPrisma.content.update).not.toHaveBeenCalled();
    });

    it("rejects when the content id does not exist at all", async () => {
      mockedPrisma.content.findUnique.mockResolvedValue(null);

      const result = await restoreContentRevisionAction(INPUT);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toBe("Content not found.");
    });
  });

  describe("13. restore is atomic if the Content update fails", () => {
    it("propagates a content.update failure without logging activity or returning success", async () => {
      mockedPrisma.content.update.mockRejectedValue(new Error("simulated DB failure"));

      await expect(restoreContentRevisionAction(INPUT)).rejects.toThrow("simulated DB failure");
      expect(mockedLogActivity).not.toHaveBeenCalled();
    });
  });

  describe("14. concurrency ordering matches the established lock-then-act sequence", () => {
    it("within the transaction: locks, looks up the revision, reads current, snapshots, then updates — in that order", async () => {
      const callOrder: string[] = [];
      mockedPrisma.$queryRaw.mockImplementation(async () => {
        callOrder.push("lock");
        return undefined;
      });
      mockedPrisma.contentRevision.findUnique.mockImplementation(async () => {
        callOrder.push("lookup-revision");
        return makeRevision();
      });
      mockedPrisma.content.findUnique.mockImplementation(async () => {
        callOrder.push("read-current");
        return makeContent();
      });
      mockedPrisma.contentRevision.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        callOrder.push("snapshot");
        return { id: "revision-new", ...data };
      });
      mockedPrisma.content.update.mockImplementation(async () => {
        callOrder.push("update");
        return makeContent();
      });

      await restoreContentRevisionAction(INPUT);

      // The first "read-current" is the pre-transaction ownership check
      // (getOwnedContent), which correctly happens before the lock — same
      // cheap-early-return precedent as updateContent/
      // updateLongFormContentAction. The second "lock" is
      // createContentRevisionSnapshot's own internal re-lock of a row this
      // transaction already holds — a documented, harmless no-op, not a
      // second real lock.
      expect(callOrder).toEqual(["read-current", "lock", "lookup-revision", "read-current", "lock", "snapshot", "update"]);
    });

    it("reuses createContentRevisionSnapshot's own count-based sequencing — does not duplicate revision-number logic", async () => {
      mockedPrisma.contentRevision.count.mockResolvedValue(3);

      await restoreContentRevisionAction(INPUT);

      const [{ data }] = mockedPrisma.contentRevision.create.mock.calls[0];
      expect(data.revisionNumber).toBe(4);
    });
  });

  describe("15. restoring an already-identical revision is a no-op", () => {
    it("returns a successful no-op, creates no revision, and performs no Content update", async () => {
      const identicalRevision = makeRevision({
        title: "Current Title",
        metaTitle: "Current Meta Title",
        metaDescription: "Current Meta Description",
        body: "Current body",
      });
      mockedPrisma.contentRevision.findUnique.mockResolvedValue(identicalRevision);

      const result = await restoreContentRevisionAction(INPUT);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.noOp).toBe(true);
      expect(mockedPrisma.contentRevision.create).not.toHaveBeenCalled();
      expect(mockedPrisma.content.update).not.toHaveBeenCalled();
      expect(mockedLogActivity).not.toHaveBeenCalled();
    });
  });

  describe("16. Activity logging failure cannot corrupt an otherwise successful restore", () => {
    it("still returns a successful, non-no-op result when logActivity throws", async () => {
      mockedLogActivity.mockRejectedValue(new Error("activity log unavailable"));

      const result = await restoreContentRevisionAction(INPUT);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.noOp).toBe(false);
      expect(mockedPrisma.content.update).toHaveBeenCalled();
    });
  });

  describe("pre-restore snapshot creation", () => {
    it("snapshots the CURRENT (pre-restore) values with changeSource RESTORE before overwriting them", async () => {
      await restoreContentRevisionAction(INPUT);

      expect(mockedPrisma.contentRevision.create).toHaveBeenCalledWith({
        data: {
          contentId: "content-1",
          companyId: COMPANY_A,
          revisionNumber: 4,
          title: "Current Title",
          metaTitle: "Current Meta Title",
          metaDescription: "Current Meta Description",
          body: "Current body",
          changeSource: "RESTORE",
          createdByUserId: "user-1",
        },
      });
    });
  });

  describe("Activity behavior", () => {
    it("logs content.revision_restored with safe identifying metadata only — no body/metaTitle/metaDescription", async () => {
      await restoreContentRevisionAction(INPUT);

      expect(mockedLogActivity).toHaveBeenCalledWith({
        actorId: "user-1",
        action: "content.revision_restored",
        companyId: COMPANY_A,
        seoProjectId: "seo-1",
        contentId: "content-1",
        metadata: {
          restoredFromRevisionId: "revision-old",
          restoredFromRevisionNumber: 1,
          preRestoreRevisionId: "revision-new",
          preRestoreRevisionNumber: 4,
          title: "Old Title",
        },
      });
    });
  });
});
