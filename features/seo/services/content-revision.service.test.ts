import { beforeEach, describe, expect, it, vi } from "vitest";

type MockPrisma = {
  contentRevision: { findMany: ReturnType<typeof vi.fn> };
};

function createMockPrisma(): MockPrisma {
  return {
    contentRevision: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { prisma } from "@/lib/prisma";
import { createContentRevisionSnapshot, getContentRevisions } from "@/features/seo/services/content-revision.service";

const mockedPrisma = prisma as unknown as MockPrisma;

describe("getContentRevisions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedPrisma.contentRevision.findMany.mockResolvedValue([]);
  });

  it("scopes the query by both contentId and companyId", async () => {
    await getContentRevisions("content-1", "company-a");

    expect(mockedPrisma.contentRevision.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { contentId: "content-1", companyId: "company-a" } })
    );
  });

  it("orders newest revision first", async () => {
    await getContentRevisions("content-1", "company-a");

    expect(mockedPrisma.contentRevision.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { revisionNumber: "desc" } })
    );
  });

  it("never selects fields outside the four tracked columns plus identity/attribution metadata", async () => {
    await getContentRevisions("content-1", "company-a");

    const [args] = mockedPrisma.contentRevision.findMany.mock.calls[0];
    expect(Object.keys(args.select).sort()).toEqual(
      ["body", "changeSource", "createdAt", "createdBy", "createdByUserId", "id", "metaDescription", "metaTitle", "revisionNumber", "title"].sort()
    );
  });

  it("selects only firstName/lastName from the createdBy relation — never email, role, or any other User field", async () => {
    await getContentRevisions("content-1", "company-a");

    const [args] = mockedPrisma.contentRevision.findMany.mock.calls[0];
    expect(args.select.createdBy).toEqual({ select: { firstName: true, lastName: true } });
  });
});

type FakeTx = {
  $queryRaw: ReturnType<typeof vi.fn>;
  contentRevision: { count: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
};

function makeFakeTx(existingCount: number): { tx: FakeTx; callOrder: string[] } {
  const callOrder: string[] = [];
  const tx: FakeTx = {
    $queryRaw: vi.fn(async () => {
      callOrder.push("lock");
      return undefined;
    }),
    contentRevision: {
      count: vi.fn(async () => {
        callOrder.push("count");
        return existingCount;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        callOrder.push("create");
        return { id: "revision-new", ...data };
      }),
    },
  };
  return { tx, callOrder };
}

const SNAPSHOT_INPUT = {
  contentId: "content-1",
  companyId: "company-a",
  title: "Old Title",
  metaTitle: "Old Meta Title",
  metaDescription: "Old Meta Description",
  body: "Old body",
  changeSource: "MANUAL_EDIT" as const,
  createdByUserId: "user-1",
};

describe("createContentRevisionSnapshot", () => {
  it("locks the Content row before counting existing revisions, and counts before creating (concurrency-safety ordering)", async () => {
    const { tx, callOrder } = makeFakeTx(0);

    await createContentRevisionSnapshot(tx as never, SNAPSHOT_INPUT);

    expect(callOrder).toEqual(["lock", "count", "create"]);
  });

  it("computes revisionNumber as the existing count + 1", async () => {
    const { tx } = makeFakeTx(4);

    const result = await createContentRevisionSnapshot(tx as never, SNAPSHOT_INPUT);

    expect(result).toMatchObject({ revisionNumber: 5 });
  });

  it("the first revision for a Content row is numbered 1, not 0", async () => {
    const { tx } = makeFakeTx(0);

    const result = await createContentRevisionSnapshot(tx as never, SNAPSHOT_INPUT);

    expect(result).toMatchObject({ revisionNumber: 1 });
  });

  it("persists exactly the pre-change field values passed in, never a post-change value", async () => {
    const { tx } = makeFakeTx(0);

    await createContentRevisionSnapshot(tx as never, SNAPSHOT_INPUT);

    expect(tx.contentRevision.create).toHaveBeenCalledWith({
      data: {
        contentId: "content-1",
        companyId: "company-a",
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

  it("regression: two sequential snapshots for the same Content each observe the prior one's committed count and receive strictly increasing, non-colliding numbers", async () => {
    // Simulates what the real FOR UPDATE lock guarantees: the second call's
    // count() can only ever run after the first call's create() has fully
    // committed, so it observes count=1, not the stale count=0 a real race
    // (no lock) could otherwise produce for both callers.
    const sharedRevisions: { revisionNumber: number }[] = [];
    const tx: FakeTx = {
      $queryRaw: vi.fn().mockResolvedValue(undefined),
      contentRevision: {
        count: vi.fn(async () => sharedRevisions.length),
        create: vi.fn(async ({ data }: { data: { revisionNumber: number } }) => {
          sharedRevisions.push({ revisionNumber: data.revisionNumber });
          return { id: `revision-${data.revisionNumber}`, ...data };
        }),
      },
    };

    const first = await createContentRevisionSnapshot(tx as never, SNAPSHOT_INPUT);
    const second = await createContentRevisionSnapshot(tx as never, { ...SNAPSHOT_INPUT, title: "Newer Title" });

    expect(first).toMatchObject({ revisionNumber: 1 });
    expect(second).toMatchObject({ revisionNumber: 2 });
    expect(sharedRevisions.map((r) => r.revisionNumber)).toEqual([1, 2]);
  });
});
