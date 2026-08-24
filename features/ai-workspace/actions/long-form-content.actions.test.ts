import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));

type MockPrisma = {
  content: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  contentRevision: { count: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  $queryRaw: ReturnType<typeof vi.fn>;
  $transaction: ReturnType<typeof vi.fn>;
};

function createMockPrisma(): MockPrisma {
  const prisma = {
    content: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    contentRevision: { count: vi.fn().mockResolvedValue(0), create: vi.fn().mockResolvedValue({ id: "revision-1" }) },
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
import { updateLongFormContentAction } from "@/features/ai-workspace/actions/long-form-content.actions";

const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedLogActivity = logActivity as unknown as ReturnType<typeof vi.fn>;
const mockedPrisma = prisma as unknown as MockPrisma;

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";
const MANAGER = { id: "user-1", role: "MANAGER", companyId: COMPANY_A };
const EMPLOYEE = { id: "user-2", role: "EMPLOYEE", companyId: COMPANY_A };

function makeOwnedContent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "content-1",
    title: "Old Title",
    metaTitle: "Old Meta Title",
    metaDescription: "Old Meta Description",
    body: "Old body",
    aiBriefDetails: null,
    keywords: [],
    seoProject: { id: "seo-1", name: "Project", domain: "example.com", companyId: COMPANY_A },
    ...overrides,
  };
}

function makeInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    contentId: "content-1",
    title: "Old Title",
    metaTitle: "Old Meta Title",
    metaDescription: "Old Meta Description",
    body: "Old body",
    ...overrides,
  };
}

describe("updateLongFormContentAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    const owned = makeOwnedContent();
    mockedPrisma.content.findUnique.mockResolvedValue(owned);
    mockedPrisma.content.update.mockResolvedValue({ id: "content-1" });
    mockedPrisma.contentRevision.count.mockResolvedValue(0);
  });

  it("denies an EMPLOYEE", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await updateLongFormContentAction(makeInput());
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
  });

  it("rejects when the actor's company differs from the Content's company", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(makeOwnedContent({ seoProject: { id: "seo-1", name: "P", domain: "d", companyId: COMPANY_B } }));
    const result = await updateLongFormContentAction(makeInput());
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
  });

  describe("2. AI regeneration creates an AI_REGENERATION revision with exact pre-change values", () => {
    it("captures the pre-change title/metaTitle/metaDescription/body when the body changes", async () => {
      await updateLongFormContentAction(makeInput({ body: "New body" }));

      expect(mockedPrisma.contentRevision.create).toHaveBeenCalledWith({
        data: {
          contentId: "content-1",
          companyId: COMPANY_A,
          revisionNumber: 1,
          title: "Old Title",
          metaTitle: "Old Meta Title",
          metaDescription: "Old Meta Description",
          body: "Old body",
          changeSource: "AI_REGENERATION",
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
        return { id: "content-1" };
      });

      await updateLongFormContentAction(makeInput({ body: "New body" }));

      expect(callOrder).toEqual(["revision", "update"]);
    });
  });

  describe("4. no revision is created when tracked fields are unchanged", () => {
    it("skips the revision when title/metaTitle/metaDescription/body are all identical", async () => {
      await updateLongFormContentAction(makeInput());

      expect(mockedPrisma.contentRevision.create).not.toHaveBeenCalled();
      expect(mockedPrisma.content.update).toHaveBeenCalled();
    });

    it("creates a revision when only metaDescription changes", async () => {
      await updateLongFormContentAction(makeInput({ metaDescription: "New Meta Description" }));
      expect(mockedPrisma.contentRevision.create).toHaveBeenCalled();
    });
  });

  describe("5. revision and Content update roll back together when the mutation fails", () => {
    it("propagates a content.update failure without logging activity or returning success", async () => {
      mockedPrisma.content.update.mockRejectedValue(new Error("simulated DB failure"));

      await expect(updateLongFormContentAction(makeInput({ body: "New body" }))).rejects.toThrow("simulated DB failure");
      expect(mockedLogActivity).not.toHaveBeenCalled();
    });
  });

  describe("6. the revision uses the authenticated user's ID", () => {
    it("sets createdByUserId to actor.id", async () => {
      await updateLongFormContentAction(makeInput({ body: "New body" }));
      const [{ data }] = mockedPrisma.contentRevision.create.mock.calls[0];
      expect(data.createdByUserId).toBe(MANAGER.id);
    });
  });

  describe("7. the revision uses the server-authorized company ID, not client input", () => {
    it("sets companyId to actor.companyId, derived server-side via getOwnedContent — never from client input", async () => {
      await updateLongFormContentAction(makeInput({ body: "New body" }));
      const [{ data }] = mockedPrisma.contentRevision.create.mock.calls[0];
      expect(data.companyId).toBe(COMPANY_A);
    });
  });

  describe("8. existing Content mutation behavior remains unchanged apart from revision creation", () => {
    it("still writes exactly title/metaTitle/metaDescription/generatedByAi/body, nothing else", async () => {
      await updateLongFormContentAction(makeInput({ title: "New Title", metaTitle: "New Meta Title", metaDescription: "New Meta Description", body: "New body" }));

      expect(mockedPrisma.content.update).toHaveBeenCalledWith({
        where: { id: "content-1" },
        data: {
          title: "New Title",
          metaTitle: "New Meta Title",
          metaDescription: "New Meta Description",
          generatedByAi: true,
          body: "New body",
        },
      });
    });

    it("still logs content.ai_long_form_saved activity with the same shape as before", async () => {
      await updateLongFormContentAction(makeInput({ body: "New body" }));
      expect(mockedLogActivity).toHaveBeenCalledWith(
        expect.objectContaining({ action: "content.ai_long_form_saved", contentId: "content-1" })
      );
    });
  });

  describe("fields not included in ContentRevision are never captured or modified by the revision mechanism", () => {
    it("never includes status or publishedAt in the ContentRevision snapshot data", async () => {
      await updateLongFormContentAction(makeInput({ body: "New body" }));

      const [{ data }] = mockedPrisma.contentRevision.create.mock.calls[0];
      expect(data).not.toHaveProperty("status");
      expect(data).not.toHaveProperty("publishedAt");
    });

    it("never includes status or publishedAt in the Content update's data either", async () => {
      await updateLongFormContentAction(makeInput({ body: "New body" }));

      const [{ data }] = mockedPrisma.content.update.mock.calls[0];
      expect(data).not.toHaveProperty("status");
      expect(data).not.toHaveProperty("publishedAt");
    });
  });
});
