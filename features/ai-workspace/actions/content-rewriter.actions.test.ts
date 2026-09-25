import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/jobs/ai-generation-job-table", () => ({
  computeInputHash: vi.fn(),
  createAiGenerationJob: vi.fn(),
  findActiveAiGenerationJob: vi.fn(),
}));
vi.mock("@/lib/jobs/ai-generation-job-runner", () => ({ runAiGenerationJob: vi.fn() }));

type MockPrisma = {
  sEOProject: { findUnique: ReturnType<typeof vi.fn> };
  content: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  contentRevision: { count: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  $queryRaw: ReturnType<typeof vi.fn>;
  $transaction: ReturnType<typeof vi.fn>;
};

function createMockPrisma(): MockPrisma {
  const prisma = {
    sEOProject: { findUnique: vi.fn() },
    content: { findUnique: vi.fn(), update: vi.fn() },
    contentRevision: { count: vi.fn().mockResolvedValue(0), create: vi.fn() },
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
import { computeInputHash, createAiGenerationJob, findActiveAiGenerationJob } from "@/lib/jobs/ai-generation-job-table";
import { runAiGenerationJob } from "@/lib/jobs/ai-generation-job-runner";
import { applyContentRewriteAction, startContentRewriteAction } from "@/features/ai-workspace/actions/content-rewriter.actions";

const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedLogActivity = logActivity as unknown as ReturnType<typeof vi.fn>;
const mockedPrisma = prisma as unknown as MockPrisma;
const mockedComputeInputHash = computeInputHash as unknown as ReturnType<typeof vi.fn>;
const mockedCreateAiGenerationJob = createAiGenerationJob as unknown as ReturnType<typeof vi.fn>;
const mockedFindActiveAiGenerationJob = findActiveAiGenerationJob as unknown as ReturnType<typeof vi.fn>;
const mockedRunAiGenerationJob = runAiGenerationJob as unknown as ReturnType<typeof vi.fn>;

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";

const MANAGER = { id: "user-manager", role: "MANAGER", companyId: COMPANY_A };
const EMPLOYEE = { id: "user-employee", role: "EMPLOYEE", companyId: COMPANY_A };

const SEO_PROJECT_ID = "00000000-0000-4000-8000-0000000000f0";
const OTHER_SEO_PROJECT_ID = "00000000-0000-4000-8000-0000000000ff";
const CONTENT_ID = "00000000-0000-4000-8000-000000000001";

const SEO_PROJECT = { id: SEO_PROJECT_ID, companyId: COMPANY_A, name: "Acme SEO", domain: "acme.test" };

const CONTENT_ROW = {
  id: CONTENT_ID,
  seoProjectId: SEO_PROJECT_ID,
  body: "## Introduction\n\nReal article body text.",
  companyId: COMPANY_A, seoProject: { companyId: COMPANY_A },
};

const VALID_INPUT = { seoProjectId: SEO_PROJECT_ID, contentId: CONTENT_ID };

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequireUser.mockResolvedValue(MANAGER);
  mockedPrisma.sEOProject.findUnique.mockResolvedValue(SEO_PROJECT);
  mockedPrisma.content.findUnique.mockResolvedValue(CONTENT_ROW);
  mockedComputeInputHash.mockReturnValue("input-hash-1");
  mockedFindActiveAiGenerationJob.mockResolvedValue(null);
  mockedCreateAiGenerationJob.mockResolvedValue({ id: "job-1" });
});

describe("startContentRewriteAction", () => {
  it("1. valid request: creates a CONTENT_REWRITE job with the authenticated actor's companyId and kicks off runAiGenerationJob", async () => {
    const result = await startContentRewriteAction(VALID_INPUT);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.jobId).toBe("job-1");
    expect(mockedCreateAiGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: COMPANY_A, seoProjectId: SEO_PROJECT_ID, contentId: CONTENT_ID, taskType: "CONTENT_REWRITE" })
    );
    expect(mockedRunAiGenerationJob).toHaveBeenCalledWith("job-1");
  });

  it("2. reuses an existing active job for identical input instead of creating a second one", async () => {
    mockedFindActiveAiGenerationJob.mockResolvedValue({ id: "existing-job" });
    const result = await startContentRewriteAction(VALID_INPUT);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.jobId).toBe("existing-job");
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("3. rejects an unauthenticated request", async () => {
    mockedRequireUser.mockRejectedValue(new Error("Not authenticated"));
    await expect(startContentRewriteAction(VALID_INPUT)).rejects.toThrow();
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("4. rejects an EMPLOYEE — below the manageSeoProjects (MANAGER) minimum", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await startContentRewriteAction(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/permission/i);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
    expect(mockedPrisma.sEOProject.findUnique).not.toHaveBeenCalled();
  });

  it("5. rejects when the SEO project does not exist", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(null);
    const result = await startContentRewriteAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("6. rejects when the SEO project belongs to another company", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, companyId: COMPANY_B });
    const result = await startContentRewriteAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("7. rejects when the content id does not exist at all", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(null);
    const result = await startContentRewriteAction(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/not found/i);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("8. rejects when the content belongs to a different SEO project than the one selected", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue({ ...CONTENT_ROW, seoProjectId: OTHER_SEO_PROJECT_ID });
    const result = await startContentRewriteAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("9. rejects when the content belongs to another company, even though the SEO project id matches", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue({ ...CONTENT_ROW, companyId: COMPANY_B, seoProject: { companyId: COMPANY_B } });
    const result = await startContentRewriteAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("10. rejects content with a null body", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue({ ...CONTENT_ROW, body: null });
    const result = await startContentRewriteAction(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/no body text/i);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("11. rejects content with an empty (whitespace-only) body", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue({ ...CONTENT_ROW, body: "   " });
    const result = await startContentRewriteAction(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/no body text/i);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("12. rejects a malformed (non-UUID) seoProjectId without any lookup", async () => {
    const result = await startContentRewriteAction({ seoProjectId: "not-a-real-id", contentId: CONTENT_ID });
    expect(result.success).toBe(false);
    expect(mockedPrisma.sEOProject.findUnique).not.toHaveBeenCalled();
  });

  it("13. rejects a malformed (non-UUID) contentId without any lookup", async () => {
    const result = await startContentRewriteAction({ seoProjectId: SEO_PROJECT_ID, contentId: "not-a-real-id" });
    expect(result.success).toBe(false);
    expect(mockedPrisma.sEOProject.findUnique).not.toHaveBeenCalled();
  });

  it("14. rejects a missing seoProjectId/contentId entirely", async () => {
    const result = await startContentRewriteAction({} as never);
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("15. never trusts a client-supplied body/title/metaTitle/metaDescription — the input schema has no such fields to smuggle them through", async () => {
    const result = await startContentRewriteAction({
      seoProjectId: SEO_PROJECT_ID,
      contentId: CONTENT_ID,
      title: "fabricated title",
      body: "fabricated body",
    } as never);
    expect(result.success).toBe(true);
    // Whatever extra fields the caller sent, only seoProjectId/contentId ever reach createAiGenerationJob's inputJson.
    const [callArgs] = mockedCreateAiGenerationJob.mock.calls[0];
    expect(callArgs.inputJson).toEqual({ seoProjectId: SEO_PROJECT_ID, contentId: CONTENT_ID });
  });
});

function makeCurrentContentRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: CONTENT_ID,
    seoProjectId: SEO_PROJECT_ID,
    title: "Current Title",
    url: "https://example.com/current",
    status: "APPROVED",
    metaTitle: "Current Meta Title",
    metaDescription: "Current Meta Description",
    body: "Current body.",
    deletedAt: null,
    companyId: COMPANY_A, seoProject: { companyId: COMPANY_A },
    ...overrides,
  };
}

const APPLY_INPUT = {
  seoProjectId: SEO_PROJECT_ID,
  contentId: CONTENT_ID,
  title: "New Rewritten Title",
  metaTitle: "New Rewritten Meta Title",
  metaDescription: "New Rewritten Meta Description",
  body: "New rewritten body.",
};

describe("applyContentRewriteAction", () => {
  beforeEach(() => {
    mockedPrisma.content.findUnique.mockResolvedValue(makeCurrentContentRow());
    mockedPrisma.contentRevision.count.mockResolvedValue(2);
    mockedPrisma.contentRevision.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "revision-new", ...data }));
    mockedPrisma.content.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...makeCurrentContentRow(), ...data }));
  });

  it("1. rejects an unauthenticated request", async () => {
    mockedRequireUser.mockRejectedValue(new Error("Not authenticated"));
    await expect(applyContentRewriteAction(APPLY_INPUT)).rejects.toThrow();
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
  });

  it("2. rejects an EMPLOYEE — below the manageSeoProjects (MANAGER) minimum", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await applyContentRewriteAction(APPLY_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/permission/i);
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
  });

  it("3. rejects a malformed (non-UUID) contentId without any lookup", async () => {
    const result = await applyContentRewriteAction({ ...APPLY_INPUT, contentId: "not-a-real-id" });
    expect(result.success).toBe(false);
    expect(mockedPrisma.sEOProject.findUnique).not.toHaveBeenCalled();
  });

  it("4. rejects an empty title/metaTitle/metaDescription/body", async () => {
    expect((await applyContentRewriteAction({ ...APPLY_INPUT, title: "" })).success).toBe(false);
    expect((await applyContentRewriteAction({ ...APPLY_INPUT, metaTitle: "" })).success).toBe(false);
    expect((await applyContentRewriteAction({ ...APPLY_INPUT, metaDescription: "" })).success).toBe(false);
    expect((await applyContentRewriteAction({ ...APPLY_INPUT, body: "" })).success).toBe(false);
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
  });

  it("5. rejects when the SEO project does not exist (nonexistent project)", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(null);
    const result = await applyContentRewriteAction(APPLY_INPUT);
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
  });

  it("6. rejects when the SEO project belongs to another company (cross-company rejection)", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, companyId: COMPANY_B });
    const result = await applyContentRewriteAction(APPLY_INPUT);
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
  });

  it("7. rejects when the content id does not exist at all (nonexistent content)", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(null);
    const result = await applyContentRewriteAction(APPLY_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/not be found/i);
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
  });

  it("8. rejects when the content belongs to a different SEO project than the one supplied (cross-project rejection)", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(makeCurrentContentRow({ seoProjectId: OTHER_SEO_PROJECT_ID }));
    const result = await applyContentRewriteAction(APPLY_INPUT);
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
  });

  it("9. rejects when the content belongs to another company, even though the SEO project id matches (cross-company rejection via content)", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(makeCurrentContentRow({ companyId: COMPANY_B, seoProject: { companyId: COMPANY_B } }));
    const result = await applyContentRewriteAction(APPLY_INPUT);
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
  });

  it("10. applies the rewrite, writing ONLY title/metaTitle/metaDescription/body (field-scoping)", async () => {
    const result = await applyContentRewriteAction(APPLY_INPUT);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.noOp).toBe(false);
    expect(mockedPrisma.content.update).toHaveBeenCalledWith({
      where: { id: CONTENT_ID },
      data: {
        title: "New Rewritten Title",
        metaTitle: "New Rewritten Meta Title",
        metaDescription: "New Rewritten Meta Description",
        body: "New rewritten body.",
      },
    });
  });

  it("11. never includes status, url, seoProjectId, or authorId in the Content update's data (field-scoping)", async () => {
    await applyContentRewriteAction(APPLY_INPUT);
    const [{ data }] = mockedPrisma.content.update.mock.calls[0];
    expect(data).not.toHaveProperty("status");
    expect(data).not.toHaveProperty("url");
    expect(data).not.toHaveProperty("seoProjectId");
    expect(data).not.toHaveProperty("authorId");
  });

  it("12. never creates a second Content row — only content.update is ever called, never content.create", async () => {
    await applyContentRewriteAction(APPLY_INPUT);
    // The mocked prisma client in this file defines no content.create at all — a real
    // attempt to create a new row would throw "is not a function", not silently succeed.
    expect(mockedPrisma.content.update).toHaveBeenCalledTimes(1);
  });

  it("13. snapshots the CURRENT (pre-apply) values into a ContentRevision with changeSource AI_REGENERATION before overwriting them (revision snapshot before update)", async () => {
    await applyContentRewriteAction(APPLY_INPUT);
    expect(mockedPrisma.contentRevision.create).toHaveBeenCalledWith({
      data: {
        contentId: CONTENT_ID,
        companyId: COMPANY_A,
        revisionNumber: 3,
        title: "Current Title",
        metaTitle: "Current Meta Title",
        metaDescription: "Current Meta Description",
        body: "Current body.",
        changeSource: "AI_REGENERATION",
        createdByUserId: "user-manager",
      },
    });
  });

  it("14. concurrency ordering: locks, reads current, snapshots, then updates — in that order (revision snapshot before update)", async () => {
    const callOrder: string[] = [];
    mockedPrisma.$queryRaw.mockImplementation(async () => {
      callOrder.push("lock");
      return undefined;
    });
    mockedPrisma.content.findUnique.mockImplementation(async () => {
      callOrder.push("read-current");
      return makeCurrentContentRow();
    });
    mockedPrisma.contentRevision.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      callOrder.push("snapshot");
      return { id: "revision-new", ...data };
    });
    mockedPrisma.content.update.mockImplementation(async () => {
      callOrder.push("update");
      return makeCurrentContentRow();
    });

    await applyContentRewriteAction(APPLY_INPUT);

    // The first "read-current" is the pre-transaction ownership check
    // (getOwnedContent), which correctly happens before the lock. The
    // second "lock" is createContentRevisionSnapshot's own internal re-lock
    // of a row this transaction already holds — a documented, harmless
    // no-op, not a second real lock (same pattern
    // restoreContentRevisionAction's own equivalent test already pins).
    expect(callOrder).toEqual(["read-current", "lock", "read-current", "lock", "snapshot", "update"]);
  });

  it("15. is a no-op when the requested title/metaTitle/metaDescription/body already match the current row — no revision, no update, no activity log (no-op apply)", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(
      makeCurrentContentRow({ title: APPLY_INPUT.title, metaTitle: APPLY_INPUT.metaTitle, metaDescription: APPLY_INPUT.metaDescription, body: APPLY_INPUT.body })
    );
    const result = await applyContentRewriteAction(APPLY_INPUT);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.noOp).toBe(true);
    expect(mockedPrisma.contentRevision.create).not.toHaveBeenCalled();
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
    expect(mockedLogActivity).not.toHaveBeenCalled();
  });

  it("16. still returns a successful, non-no-op result when logActivity throws", async () => {
    mockedLogActivity.mockRejectedValue(new Error("activity log unavailable"));
    const result = await applyContentRewriteAction(APPLY_INPUT);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.noOp).toBe(false);
    expect(mockedPrisma.content.update).toHaveBeenCalled();
  });

  it("17. logs content.ai_rewrite_applied with the actor and the applied title", async () => {
    await applyContentRewriteAction(APPLY_INPUT);
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: "user-manager",
      action: "content.ai_rewrite_applied",
      companyId: COMPANY_A,
      seoProjectId: SEO_PROJECT_ID,
      contentId: CONTENT_ID,
      metadata: { title: "New Rewritten Title" },
    });
  });

  it("18. propagates a content.update failure without logging activity or returning success (atomicity)", async () => {
    mockedPrisma.content.update.mockRejectedValue(new Error("simulated DB failure"));
    await expect(applyContentRewriteAction(APPLY_INPUT)).rejects.toThrow("simulated DB failure");
    expect(mockedLogActivity).not.toHaveBeenCalled();
  });

  /**
   * Phase B M2 — a trashed (soft-deleted) page must never be written to.
   * The route page already filters deletedAt when listing selectable pages,
   * so this covers the two ways a trashed id still reaches the server: a
   * stale review screen open when someone else trashes the page, and a
   * direct server-action call.
   */
  it("19. rejects applying to a SOFT-DELETED page (direct invocation)", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(makeCurrentContentRow({ deletedAt: new Date("2026-09-01T00:00:00Z") }));
    const result = await applyContentRewriteAction(APPLY_INPUT);
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
    expect(mockedPrisma.contentRevision.create).not.toHaveBeenCalled();
  });

  it("20. rejects when the page is trashed AFTER the ownership check but before the write (stale review state)", async () => {
    // First read (ownership) sees an active row; the in-transaction re-read sees it trashed.
    mockedPrisma.content.findUnique
      .mockResolvedValueOnce(makeCurrentContentRow())
      .mockResolvedValue(makeCurrentContentRow({ deletedAt: new Date("2026-09-01T00:00:00Z") }));
    const result = await applyContentRewriteAction(APPLY_INPUT);
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
    expect(mockedPrisma.contentRevision.create).not.toHaveBeenCalled();
  });

  it("21. still applies normally to an ACTIVE page (no regression)", async () => {
    const result = await applyContentRewriteAction(APPLY_INPUT);
    expect(result.success).toBe(true);
    expect(mockedPrisma.content.update).toHaveBeenCalled();
  });
});

/**
 * C4 security-consistency pass — the server-side lifecycle boundary.
 *
 * getOwnedSeoProject now rejects a soft-deleted project, matching the rule
 * getOwnedContent already applies to the Content row. Both
 * startContentRewriteAction and applyContentRewriteAction route through that
 * one helper, so both paths are covered here. The picker never lists a
 * trashed project and the C4 contextual action hides itself for one, but
 * neither is the boundary — these tests drive the actions directly, the way a
 * crafted request would.
 */
describe("Content Rewriter — project/content lifecycle is enforced server-side", () => {
  const TRASHED = new Date("2026-08-12T00:00:00.000Z");

  describe("startContentRewriteAction", () => {
    it("22. ALLOWED — active owned project + active owned Content", async () => {
      const result = await startContentRewriteAction(VALID_INPUT);
      expect(result.success).toBe(true);
      expect(mockedCreateAiGenerationJob).toHaveBeenCalled();
    });

    it("23. ALLOWED — fixtures that OMIT deletedAt are treated as live, never wrongly rejected", async () => {
      // Neither fixture carries the key; a `!== null` check would break both.
      expect("deletedAt" in SEO_PROJECT).toBe(false);
      expect("deletedAt" in CONTENT_ROW).toBe(false);
      const result = await startContentRewriteAction(VALID_INPUT);
      expect(result.success).toBe(true);
    });

    it("24. REJECTED — soft-deleted SEO project, even though it belongs to the actor's own company", async () => {
      mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, deletedAt: TRASHED });
      const result = await startContentRewriteAction(VALID_INPUT);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toMatch(/not found/i);
      expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
      expect(mockedRunAiGenerationJob).not.toHaveBeenCalled();
    });

    it("25. REJECTED — soft-deleted Content under a live owned project", async () => {
      mockedPrisma.content.findUnique.mockResolvedValue({ ...CONTENT_ROW, deletedAt: TRASHED });
      const result = await startContentRewriteAction(VALID_INPUT);
      expect(result.success).toBe(false);
      expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
      expect(mockedRunAiGenerationJob).not.toHaveBeenCalled();
    });

    it("26. REJECTED — FOREIGN project (another company)", async () => {
      mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, companyId: COMPANY_B });
      const result = await startContentRewriteAction(VALID_INPUT);
      expect(result.success).toBe(false);
      expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
    });

    it("27. REJECTED — FOREIGN Content (another company)", async () => {
      mockedPrisma.content.findUnique.mockResolvedValue({ ...CONTENT_ROW, companyId: COMPANY_B, seoProject: { companyId: COMPANY_B } });
      const result = await startContentRewriteAction(VALID_INPUT);
      expect(result.success).toBe(false);
      expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
    });

    it("28. REJECTED — PROJECT MISMATCH: Content of the same company but a different project", async () => {
      mockedPrisma.content.findUnique.mockResolvedValue({ ...CONTENT_ROW, seoProjectId: "00000000-0000-4000-8000-0000000000ff" });
      const result = await startContentRewriteAction(VALID_INPUT);
      expect(result.success).toBe(false);
      expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
    });

    it("29. a trashed project short-circuits BEFORE the Content row is ever read", async () => {
      mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, deletedAt: TRASHED });
      await startContentRewriteAction(VALID_INPUT);
      expect(mockedPrisma.content.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("applyContentRewriteAction — the same guard covers the write path", () => {
    beforeEach(() => {
      mockedPrisma.content.findUnique.mockResolvedValue(CONTENT_ROW);
    });

    it("30. REJECTED — a soft-deleted project blocks APPLY, so no Content is ever written", async () => {
      mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, deletedAt: TRASHED });
      const result = await applyContentRewriteAction(APPLY_INPUT);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toMatch(/not found/i);
      expect(mockedPrisma.content.update).not.toHaveBeenCalled();
      expect(mockedPrisma.contentRevision.create).not.toHaveBeenCalled();
    });

    it("31. REJECTED — a FOREIGN project blocks APPLY", async () => {
      mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, companyId: COMPANY_B });
      const result = await applyContentRewriteAction(APPLY_INPUT);
      expect(result.success).toBe(false);
      expect(mockedPrisma.content.update).not.toHaveBeenCalled();
    });
  });
});
