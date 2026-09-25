import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/features/seo/services/content-revision.service", () => ({ createContentRevisionSnapshot: vi.fn() }));

type MockPrisma = {
  client: { findUnique: ReturnType<typeof vi.fn> };
  sEOProject: { findUnique: ReturnType<typeof vi.fn> };
  content: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  keyword: { findMany: ReturnType<typeof vi.fn> };
  tag: { findMany: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

function createMockPrisma(): MockPrisma {
  const prisma = {
    client: { findUnique: vi.fn() },
    sEOProject: { findUnique: vi.fn() },
    content: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    keyword: { findMany: vi.fn() },
    tag: { findMany: vi.fn() },
  } as unknown as MockPrisma;
  prisma.$transaction = vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") return (arg as (tx: MockPrisma) => unknown)(prisma);
    return Promise.all(arg as Promise<unknown>[]);
  });
  return prisma;
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { saveBlogPostAction, type SaveBlogPostInput } from "@/features/blog/actions/blog-post.actions";
import { createContentRevisionSnapshot } from "@/features/seo/services/content-revision.service";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const mockedPrisma = prisma as unknown as MockPrisma;
const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedSnapshot = createContentRevisionSnapshot as unknown as ReturnType<typeof vi.fn>;

const CLIENT_ID = "00000000-0000-0000-0000-000000000006";
const PROJECT_ID = "01a002a5-ffa5-705e-9731-806267514305";
const CONTENT_ID = "01a016c7-c1c5-74fb-9c43-c35ad68146e8";
const KEYWORD_ID = "01a04444-4444-7444-b444-444444444444";
const FOREIGN_KEYWORD_ID = "01a05555-5555-7555-b555-555555555555";
const ADMIN = { id: "user-1", companyId: "company-1", role: "SUPER_ADMIN" };
const VIEWER = { id: "user-2", companyId: "company-1", role: "VIEWER" };
const YEAR = new Date().getUTCFullYear() + 2;

const input = (over: Partial<SaveBlogPostInput> = {}): SaveBlogPostInput => ({
  clientId: CLIENT_ID,
  seoProjectId: PROJECT_ID,
  title: "Unlocking self storage investments",
  body: "## Why unit mix matters\n\nOccupancy alone tells you little.\n\n![Chart](/api/files/img-1 \"Typical mix\")",
  metaTitle: "",
  metaDescription: "",
  url: "",
  authorId: "",
  keywordIds: [],
  tagIds: [],
  ...over,
});

const existingRow = (over: Record<string, unknown> = {}) => ({
  id: CONTENT_ID,
  status: "DRAFT",
  title: "Old title",
  metaTitle: null,
  metaDescription: null,
  body: "Old body",
  deletedAt: null,
  seoProjectId: PROJECT_ID,
  companyId: "company-1",
  clientId: CLIENT_ID,
  socialPost: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequireUser.mockResolvedValue(ADMIN);
  mockedPrisma.client.findUnique.mockResolvedValue({ id: CLIENT_ID, companyId: "company-1", deletedAt: null });
  mockedPrisma.sEOProject.findUnique.mockResolvedValue({ id: PROJECT_ID, companyId: "company-1", clientId: CLIENT_ID, deletedAt: null });
  mockedPrisma.keyword.findMany.mockResolvedValue([]);
  mockedPrisma.tag.findMany.mockResolvedValue([]);
  mockedPrisma.content.create.mockResolvedValue({ id: CONTENT_ID });
  mockedPrisma.content.update.mockResolvedValue({ id: CONTENT_ID });
});

describe("authorization", () => {
  it("1. refuses a role that cannot manage SEO projects", async () => {
    mockedRequireUser.mockResolvedValue(VIEWER);
    expect((await saveBlogPostAction(input())).success).toBe(false);
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("2. refuses another company's project, as not found", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ id: PROJECT_ID, companyId: "other", clientId: CLIENT_ID, deletedAt: null });
    const result = await saveBlogPostAction(input());
    expect(!result.success && result.message).toBe("SEO project not found.");
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("3. a malformed project id is never queried, and never attached to the article", async () => {
    for (const seoProjectId of ["not-a-uuid", "../x"]) {
      mockedPrisma.sEOProject.findUnique.mockClear();
      mockedPrisma.content.create.mockClear();
      // The project is optional, so a junk value is refused as a project
      // rather than accepted as one — it must not reach the database.
      const result = await saveBlogPostAction(input({ seoProjectId }));
      expect(result.success).toBe(false);
      expect(mockedPrisma.sEOProject.findUnique).not.toHaveBeenCalled();
      expect(mockedPrisma.content.create).not.toHaveBeenCalled();
    }
  });

  it("4. refuses a soft-deleted project", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ id: PROJECT_ID, companyId: "company-1", clientId: CLIENT_ID, deletedAt: new Date("2026-01-01") });
    expect((await saveBlogPostAction(input())).success).toBe(false);
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("5. refuses editing another company's article", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(existingRow({ companyId: "other" }));
    expect((await saveBlogPostAction(input({ contentId: CONTENT_ID }))).success).toBe(false);
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
  });

  it("6. refuses an article belonging to a DIFFERENT CLIENT — the client is the boundary now", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(existingRow({ clientId: "01a09999-9999-7999-b999-999999999999" }));
    expect((await saveBlogPostAction(input({ contentId: CONTENT_ID }))).success).toBe(false);
  });

  it("6b. an article in a DIFFERENT PROJECT but the same client is still editable — the project is context, not the owner", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(existingRow({ seoProjectId: "01a09999-9999-7999-b999-999999999999" }));
    expect((await saveBlogPostAction(input({ contentId: CONTENT_ID }))).success).toBe(true);
  });

  it("6c. NO SEO PROJECT IS REQUIRED — a client-only article saves", async () => {
    const result = await saveBlogPostAction(input({ seoProjectId: undefined }));
    expect(result.success).toBe(true);
    expect(mockedPrisma.sEOProject.findUnique).not.toHaveBeenCalled();
  });

  it("7. refuses a trashed article", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(existingRow({ deletedAt: new Date("2026-01-01") }));
    expect((await saveBlogPostAction(input({ contentId: CONTENT_ID }))).success).toBe(false);
  });

  it("8. refuses to open a SOCIAL post in the article editor", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(existingRow({ socialPost: { id: "social-1" } }));
    const result = await saveBlogPostAction(input({ contentId: CONTENT_ID }));
    expect(result.success).toBe(false);
    expect(!result.success && result.message).toMatch(/social composer/i);
  });
});

describe("keywords cannot cross a project boundary", () => {
  it("9. only this project's keywords are queried", async () => {
    await saveBlogPostAction(input({ keywordIds: [KEYWORD_ID, FOREIGN_KEYWORD_ID] }));
    const [{ where }] = mockedPrisma.keyword.findMany.mock.calls[0];
    expect(where.seoProjectId).toBe(PROJECT_ID);
    expect(where.id.in).toEqual([KEYWORD_ID, FOREIGN_KEYWORD_ID]);
  });

  it("10. a keyword the query does not return is never connected", async () => {
    mockedPrisma.keyword.findMany.mockResolvedValue([{ id: KEYWORD_ID }]);
    await saveBlogPostAction(input({ keywordIds: [KEYWORD_ID, FOREIGN_KEYWORD_ID] }));
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.keywords).toEqual({ connect: [{ id: KEYWORD_ID }] });
  });

  it("11. a malformed keyword id never reaches the database", async () => {
    await saveBlogPostAction(input({ keywordIds: ["nope", ""] }));
    expect(mockedPrisma.keyword.findMany).not.toHaveBeenCalled();
  });
});

describe("saving the article", () => {
  it("12. stores the body as Markdown, exactly as given", async () => {
    const body = input().body;
    await saveBlogPostAction(input());
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.body).toBe(body);
    expect(data.body).toContain("![Chart](/api/files/img-1");
  });

  it("13. stores title, SEO fields and URL on the Content record", async () => {
    await saveBlogPostAction(input({ metaTitle: "SEO title", metaDescription: "SEO description", url: "self-storage" }));
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.title).toBe("Unlocking self storage investments");
    expect(data.metaTitle).toBe("SEO title");
    expect(data.metaDescription).toBe("SEO description");
    expect(data.url).toBe("self-storage");
  });

  it("14. empty SEO fields are stored as null, never as empty strings", async () => {
    await saveBlogPostAction(input({ metaTitle: "  ", metaDescription: "", url: "" }));
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.metaTitle).toBeNull();
    expect(data.metaDescription).toBeNull();
    expect(data.url).toBeNull();
  });

  it("15. a new article is DRAFT and carries no schedule", async () => {
    const result = await saveBlogPostAction(input());
    expect(result.success && result.data.scheduled).toBe(false);
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.status).toBe("DRAFT");
    expect(data.scheduledAt).toBeNull();
  });

  it("16. scheduling is applied only when explicitly requested", async () => {
    const result = await saveBlogPostAction(input({ schedule: { dateIso: `${YEAR}-09-20`, time: "10:00", timeZone: "Europe/London" } }));
    expect(result.success && result.data.scheduled).toBe(true);
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.status).toBe("SCHEDULED");
    expect((data.scheduledAt as Date).toISOString()).toBe(`${YEAR}-09-20T09:00:00.000Z`);
    expect(data.scheduledTimezone).toBe("Europe/London");
  });

  it("17. publishedAt is never written", async () => {
    await saveBlogPostAction(input());
    await saveBlogPostAction(input({ schedule: { dateIso: `${YEAR}-09-20`, time: "10:00", timeZone: "UTC" } }));
    for (const [{ data }] of mockedPrisma.content.create.mock.calls) {
      expect(data).not.toHaveProperty("publishedAt");
      expect(data.status).not.toBe("PUBLISHED");
    }
  });

  it("18. a past schedule is refused and nothing is written", async () => {
    const result = await saveBlogPostAction(input({ schedule: { dateIso: "2020-01-01", time: "10:00", timeZone: "UTC" } }));
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("19. a title that is too short or too long is refused", async () => {
    expect((await saveBlogPostAction(input({ title: "a" }))).success).toBe(false);
    expect((await saveBlogPostAction(input({ title: "a".repeat(250) }))).success).toBe(false);
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("20. a URL with an executable scheme is refused", async () => {
    for (const url of ["javascript:alert(1)", "data:text/html,x"]) {
      expect((await saveBlogPostAction(input({ url }))).success).toBe(false);
    }
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("21. a plain slug and a full https URL are both accepted", async () => {
    expect((await saveBlogPostAction(input({ url: "self-storage-tips" }))).success).toBe(true);
    expect((await saveBlogPostAction(input({ url: "https://example.com/post" }))).success).toBe(true);
  });
});

describe("revisions use the existing system", () => {
  beforeEach(() => {
    mockedPrisma.content.findUnique.mockResolvedValue(existingRow());
  });

  it("22. editing an article snapshots the PREVIOUS version first", async () => {
    await saveBlogPostAction(input({ contentId: CONTENT_ID, title: "New title" }));
    expect(mockedSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ contentId: CONTENT_ID, title: "Old title", body: "Old body", changeSource: "MANUAL_EDIT" })
    );
  });

  it("23. the snapshot happens inside the same transaction as the write", async () => {
    await saveBlogPostAction(input({ contentId: CONTENT_ID, title: "New title" }));
    expect(mockedPrisma.$transaction).toHaveBeenCalled();
    expect(mockedPrisma.content.update).toHaveBeenCalled();
  });

  it("24. saving with nothing changed creates no revision", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(existingRow({ title: "Same", body: "Same body" }));
    const result = await saveBlogPostAction(input({ contentId: CONTENT_ID, title: "Same", body: "Same body" }));
    expect(result.success && result.data.contentId).toBe(CONTENT_ID);
    expect(mockedSnapshot).not.toHaveBeenCalled();
  });

  it("25. a meta-only change still records a revision", async () => {
    await saveBlogPostAction(input({ contentId: CONTENT_ID, title: "Old title", body: "Old body", metaTitle: "New meta" }));
    expect(mockedSnapshot).toHaveBeenCalled();
  });

  it("26. editing updates the existing record rather than creating a second one", async () => {
    await saveBlogPostAction(input({ contentId: CONTENT_ID }));
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
    expect(mockedPrisma.content.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: CONTENT_ID } }));
  });

  it("27. editing without a schedule leaves the existing status alone", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(existingRow({ status: "APPROVED" }));
    await saveBlogPostAction(input({ contentId: CONTENT_ID }));
    const [{ data }] = mockedPrisma.content.update.mock.calls[0];
    expect(data).not.toHaveProperty("status");
  });
});

describe("tags are company-owned and cannot cross a company boundary", () => {
  const TAG_ID = "01a06666-6666-7666-b666-666666666666";
  const FOREIGN_TAG_ID = "01a07777-7777-7777-b777-777777777777";

  it("28. only THIS company's tags are queried", async () => {
    await saveBlogPostAction(input({ tagIds: [TAG_ID, FOREIGN_TAG_ID] }));
    const [{ where }] = mockedPrisma.tag.findMany.mock.calls[0];
    expect(where.companyId).toBe("company-1");
    expect(where.id.in).toEqual([TAG_ID, FOREIGN_TAG_ID]);
  });

  it("29. a tag the query does not return is never connected", async () => {
    mockedPrisma.tag.findMany.mockResolvedValue([{ id: TAG_ID }]);
    await saveBlogPostAction(input({ tagIds: [TAG_ID, FOREIGN_TAG_ID] }));
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.tags).toEqual({ connect: [{ id: TAG_ID }] });
  });

  it("30. a malformed tag id never reaches the database", async () => {
    await saveBlogPostAction(input({ tagIds: ["nope", ""] }));
    expect(mockedPrisma.tag.findMany).not.toHaveBeenCalled();
  });

  it("31. no tags means none are connected rather than an empty connect", async () => {
    await saveBlogPostAction(input());
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.tags).toBeUndefined();
  });

  it("32. an edit REPLACES the tag set, so an unselected tag does not linger", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(existingRow());
    mockedPrisma.tag.findMany.mockResolvedValue([{ id: TAG_ID }]);
    await saveBlogPostAction(input({ contentId: CONTENT_ID, tagIds: [TAG_ID] }));
    const [{ data }] = mockedPrisma.content.update.mock.calls[0];
    expect(data.tags).toEqual({ set: [{ id: TAG_ID }] });
  });
});

describe("editorial status", () => {
  it("33. a status a human may choose is applied, and clears any schedule with it", async () => {
    await saveBlogPostAction(input({ status: "APPROVED" }));
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.status).toBe("APPROVED");
    expect(data.scheduledAt).toBeNull();
    expect(data.scheduledTimezone).toBeNull();
  });

  it("34. SCHEDULED is refused as a status, because it carries no date", async () => {
    const result = await saveBlogPostAction(input({ status: "SCHEDULED" }));
    expect(result.success).toBe(false);
    expect(!result.success && result.message).toMatch(/scheduling controls/i);
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("35. an unknown status is refused", async () => {
    for (const status of ["PUBLISHED_SOON", "nonsense", "draft"]) {
      expect((await saveBlogPostAction(input({ status }))).success).toBe(false);
    }
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("36. an omitted status leaves an existing record's status alone", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(existingRow({ status: "SCHEDULED" }));
    await saveBlogPostAction(input({ contentId: CONTENT_ID }));
    const [{ data }] = mockedPrisma.content.update.mock.calls[0];
    expect(data).not.toHaveProperty("status");
    expect(data).not.toHaveProperty("scheduledAt");
  });

  it("37. a schedule outranks a status — the record becomes SCHEDULED", async () => {
    await saveBlogPostAction(input({ status: "APPROVED", schedule: { dateIso: `${YEAR}-09-20`, time: "10:00", timeZone: "UTC" } }));
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.status).toBe("SCHEDULED");
  });

  it("38. an empty status string is treated as 'leave it alone', not as invalid", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(existingRow());
    const result = await saveBlogPostAction(input({ contentId: CONTENT_ID, status: "" }));
    expect(result.success).toBe(true);
    const [{ data }] = mockedPrisma.content.update.mock.calls[0];
    expect(data).not.toHaveProperty("status");
  });
});

/* ------------------------------- content type --------------------------- */

describe("a Blog Studio record says it is a blog post", () => {
  it("41. the created Content row records contentType BLOG_POST", async () => {
    await saveBlogPostAction(input());
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.contentType).toBe("BLOG_POST");
  });

  it("42. it does so with no SEO project too — blog is not SEO content", async () => {
    await saveBlogPostAction(input({ seoProjectId: undefined }));
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.contentType).toBe("BLOG_POST");
    expect(data.seoProjectId).toBeNull();
  });
});
