import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/features/publishing/services/ssrf-guard.service", () => ({ assertSafePublicUrl: vi.fn() }));

type MockPrisma = {
  client: { findUnique: ReturnType<typeof vi.fn> };
  sEOProject: { findUnique: ReturnType<typeof vi.fn> };
  content: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  socialAccount: { findMany: ReturnType<typeof vi.fn> };
  socialPost: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  socialPostTarget: { deleteMany: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

function createMockPrisma(): MockPrisma {
  const prisma = {
    client: { findUnique: vi.fn() },
    sEOProject: { findUnique: vi.fn() },
    content: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    socialAccount: { findMany: vi.fn() },
    socialPost: { create: vi.fn(), update: vi.fn() },
    socialPostTarget: { deleteMany: vi.fn(), upsert: vi.fn() },
  } as unknown as MockPrisma;
  prisma.$transaction = vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") return (arg as (tx: MockPrisma) => unknown)(prisma);
    return Promise.all(arg as Promise<unknown>[]);
  });
  return prisma;
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { saveSocialPostAction, type SaveSocialPostInput } from "@/features/social/actions/social-post.actions";
import { assertSafePublicUrl } from "@/features/publishing/services/ssrf-guard.service";
import { logActivity } from "@/lib/activity";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const mockedPrisma = prisma as unknown as MockPrisma;
const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedSafeUrl = assertSafePublicUrl as unknown as ReturnType<typeof vi.fn>;
const mockedLogActivity = logActivity as unknown as ReturnType<typeof vi.fn>;

const PROJECT_ID = "01a002a5-ffa5-705e-9731-806267514305";
const CONTENT_ID = "01a016c7-c1c5-74fb-9c43-c35ad68146e8";
const CLIENT_ID = "00000000-0000-0000-0000-000000000006";
const ACCOUNT_ID = "01a02222-2222-7222-b222-222222222222";
const FOREIGN_ACCOUNT_ID = "01a03333-3333-7333-b333-333333333333";

const ADMIN = { id: "user-1", companyId: "company-1", role: "SUPER_ADMIN" };
const VIEWER = { id: "user-2", companyId: "company-1", role: "VIEWER" };

const YEAR = new Date().getUTCFullYear() + 2;

const input = (over: Partial<SaveSocialPostInput> = {}): SaveSocialPostInput => ({
  clientId: CLIENT_ID,
  seoProjectId: PROJECT_ID,
  caption: "Three things to check before buying. #selfstorage",
  link: "",
  accountIds: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequireUser.mockResolvedValue(ADMIN);
  mockedPrisma.client.findUnique.mockResolvedValue({ id: CLIENT_ID, companyId: "company-1", deletedAt: null });
  mockedPrisma.sEOProject.findUnique.mockResolvedValue({ id: PROJECT_ID, companyId: "company-1", clientId: CLIENT_ID, deletedAt: null });
  mockedPrisma.socialAccount.findMany.mockResolvedValue([]);
  mockedPrisma.content.create.mockResolvedValue({ id: CONTENT_ID });
  mockedPrisma.content.update.mockResolvedValue({ id: CONTENT_ID });
  mockedPrisma.socialPost.create.mockResolvedValue({ id: "social-1" });
  mockedPrisma.socialPost.update.mockResolvedValue({ id: "social-1" });
  mockedPrisma.socialPostTarget.deleteMany.mockResolvedValue({ count: 0 });
  mockedPrisma.socialPostTarget.upsert.mockResolvedValue({});
  mockedSafeUrl.mockResolvedValue({});
});

describe("authorization", () => {
  it("1. refuses a role that cannot manage SEO projects", async () => {
    mockedRequireUser.mockResolvedValue(VIEWER);
    const result = await saveSocialPostAction(input());
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("2. refuses another company's CLIENT — as not found, never as forbidden", async () => {
    mockedPrisma.client.findUnique.mockResolvedValue({ id: CLIENT_ID, companyId: "other-company", deletedAt: null });
    const result = await saveSocialPostAction(input());
    expect(result.success).toBe(false);
    expect(!result.success && result.message).toBe("Client not found.");
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("2b. refuses another company's project when one IS supplied", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ id: PROJECT_ID, companyId: "other-company", clientId: CLIENT_ID, deletedAt: null });
    const result = await saveSocialPostAction(input({ seoProjectId: PROJECT_ID }));
    expect(result.success).toBe(false);
    expect(!result.success && result.message).toBe("SEO project not found.");
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("2c. refuses a project belonging to a DIFFERENT client, even within the company", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ id: PROJECT_ID, companyId: "company-1", clientId: "00000000-0000-0000-0000-0000000000ff", deletedAt: null });
    const result = await saveSocialPostAction(input({ seoProjectId: PROJECT_ID }));
    expect(result.success).toBe(false);
    expect(!result.success && result.message).toMatch(/different client/i);
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("3. refuses a malformed client id WITHOUT querying", async () => {
    for (const clientId of ["", "not-a-uuid", "../etc", "1 OR 1=1"]) {
      mockedPrisma.client.findUnique.mockClear();
      const result = await saveSocialPostAction(input({ clientId }));
      expect(result.success).toBe(false);
      expect(mockedPrisma.client.findUnique).not.toHaveBeenCalled();
    }
  });

  it("3b. NO SEO PROJECT IS REQUIRED — a client-only post saves", async () => {
    const result = await saveSocialPostAction(input({ seoProjectId: undefined }));
    expect(result.success).toBe(true);
    expect(mockedPrisma.sEOProject.findUnique).not.toHaveBeenCalled();
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.companyId).toBe("company-1");
    expect(data.clientId).toBe(CLIENT_ID);
    expect(data.seoProjectId).toBeNull();
  });

  it("4. refuses a soft-deleted project when one is supplied", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ id: PROJECT_ID, companyId: "company-1", clientId: CLIENT_ID, deletedAt: new Date("2026-01-01") });
    const result = await saveSocialPostAction(input({ seoProjectId: PROJECT_ID }));
    expect(result.success).toBe(false);
    expect(!result.success && result.message).toMatch(/in the trash/i);
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("5. refuses editing a Content record from another company", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue({
      id: CONTENT_ID, status: "DRAFT", deletedAt: null,
      companyId: "other-company", clientId: CLIENT_ID, seoProjectId: PROJECT_ID, socialPost: { id: "social-1" },
    });
    const result = await saveSocialPostAction(input({ contentId: CONTENT_ID }));
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
  });

  it("6. refuses editing a Content record that is not a social post", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue({
      id: CONTENT_ID, status: "DRAFT", deletedAt: null,
      companyId: "company-1", clientId: CLIENT_ID, seoProjectId: PROJECT_ID, socialPost: null,
    });
    const result = await saveSocialPostAction(input({ contentId: CONTENT_ID }));
    expect(result.success).toBe(false);
    expect(!result.success && result.message).toMatch(/not a social post/i);
  });

  it("7. refuses a content id belonging to a DIFFERENT project than the one submitted", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue({
      id: CONTENT_ID, status: "DRAFT", deletedAt: null,
      companyId: "company-1", clientId: "01a09999-9999-7999-b999-999999999999", seoProjectId: PROJECT_ID, socialPost: { id: "social-1" },
    });
    const result = await saveSocialPostAction(input({ contentId: CONTENT_ID }));
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
  });
});

describe("account targets cannot cross a client boundary", () => {
  it("8. only accounts belonging to THIS project's client are queried", async () => {
    await saveSocialPostAction(input({ accountIds: [ACCOUNT_ID, FOREIGN_ACCOUNT_ID] }));
    const [{ where }] = mockedPrisma.socialAccount.findMany.mock.calls[0];
    expect(where).toMatchObject({ companyId: "company-1", clientId: CLIENT_ID, deletedAt: null, status: "ACTIVE" });
    expect(where.id.in).toEqual([ACCOUNT_ID, FOREIGN_ACCOUNT_ID]);
  });

  it("9. an account the query does not return is never written as a target", async () => {
    // The client's own account list comes back with only one of the two ids.
    // ONE query now resolves both the ids and their platforms — a second
    // queued value would linger and leak into the next test.
    mockedPrisma.socialAccount.findMany.mockResolvedValueOnce([{ id: ACCOUNT_ID, platform: "LINKEDIN", handle: "@acme", displayName: null }]);
    await saveSocialPostAction(input({ accountIds: [ACCOUNT_ID, FOREIGN_ACCOUNT_ID] }));
    const written = mockedPrisma.socialPostTarget.upsert.mock.calls.map(([call]) => call.create.socialAccountId);
    expect(written).toEqual([ACCOUNT_ID]);
    expect(written).not.toContain(FOREIGN_ACCOUNT_ID);
  });

  it("10. a malformed account id is dropped before it reaches the database", async () => {
    await saveSocialPostAction(input({ accountIds: ["not-a-uuid", ""] }));
    expect(mockedPrisma.socialAccount.findMany).not.toHaveBeenCalled();
    expect(mockedPrisma.socialPostTarget.upsert).not.toHaveBeenCalled();
  });

  it("11. accounts are resolved against THIS post's client, not a project", async () => {
    await saveSocialPostAction(input({ accountIds: [ACCOUNT_ID] }));
    const [{ where }] = mockedPrisma.socialAccount.findMany.mock.calls[0];
    expect(where.companyId).toBe("company-1");
    expect(where.clientId).toBe(CLIENT_ID);
  });

  it("11b. an account that is not this client's simply does not come back, so it is never targeted", async () => {
    mockedPrisma.socialAccount.findMany.mockResolvedValueOnce([]);
    const result = await saveSocialPostAction(input({ accountIds: [FOREIGN_ACCOUNT_ID] }));
    expect(result.success).toBe(true);
    expect(mockedPrisma.socialPostTarget.upsert).not.toHaveBeenCalled();
  });

  it("12. unselected targets are removed, so a stale target cannot linger", async () => {
    await saveSocialPostAction(input());
    expect(mockedPrisma.socialPostTarget.deleteMany).toHaveBeenCalled();
  });
});

describe("draft versus scheduled", () => {
  it("13. saving WITHOUT a schedule stays DRAFT and writes no schedule fields", async () => {
    const result = await saveSocialPostAction(input());
    expect(result.success).toBe(true);
    expect(result.success && result.data.scheduled).toBe(false);
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.status).toBe("DRAFT");
    expect(data.scheduledAt).toBeNull();
    expect(data.scheduledTimezone).toBeNull();
  });

  it("14. saving WITH an explicit schedule sets SCHEDULED and both fields", async () => {
    const result = await saveSocialPostAction(input({ schedule: { dateIso: `${YEAR}-09-20`, time: "10:00", timeZone: "Europe/London" } }));
    expect(result.success && result.data.scheduled).toBe(true);
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.status).toBe("SCHEDULED");
    expect((data.scheduledAt as Date).toISOString()).toBe(`${YEAR}-09-20T09:00:00.000Z`);
    expect(data.scheduledTimezone).toBe("Europe/London");
  });

  it("15. publishedAt is never written by either path", async () => {
    await saveSocialPostAction(input());
    await saveSocialPostAction(input({ schedule: { dateIso: `${YEAR}-09-20`, time: "10:00", timeZone: "UTC" } }));
    for (const [{ data }] of mockedPrisma.content.create.mock.calls) {
      expect(data).not.toHaveProperty("publishedAt");
      expect(data.status).not.toBe("PUBLISHED");
    }
  });

  it("16. a past schedule is refused and nothing is written", async () => {
    const result = await saveSocialPostAction(input({ schedule: { dateIso: "2020-01-01", time: "10:00", timeZone: "UTC" } }));
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("17. an invalid timezone is refused and nothing is written", async () => {
    const result = await saveSocialPostAction(input({ schedule: { dateIso: `${YEAR}-09-20`, time: "10:00", timeZone: "Mars/Olympus" } }));
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });
});

describe("content and caption persistence", () => {
  it("18. the caption goes to SocialPost, never to Content.body", async () => {
    await saveSocialPostAction(input());
    const [{ data: contentData }] = mockedPrisma.content.create.mock.calls[0];
    expect(contentData.body).toBeNull();
    expect(contentData.url).toBeNull();
    const [{ data: socialData }] = mockedPrisma.socialPost.create.mock.calls[0];
    expect(socialData.caption).toBe("Three things to check before buying. #selfstorage");
  });

  it("19. Content.title is DERIVED from the caption, not supplied by the caller", async () => {
    await saveSocialPostAction(input());
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    // The default caption is "Three things to check before buying. #selfstorage".
    expect(data.title).toBe("Three things to check before buying.");
  });

  it("19b. the derived name is refreshed on every save, so it never drifts from the caption", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue({
      id: CONTENT_ID, status: "DRAFT", deletedAt: null,
      companyId: "company-1", clientId: CLIENT_ID, seoProjectId: PROJECT_ID, socialPost: { id: "social-1" },
    });
    await saveSocialPostAction(input({ contentId: CONTENT_ID, caption: "A completely different message now." }));
    const [{ data }] = mockedPrisma.content.update.mock.calls[0];
    expect(data.title).toBe("A completely different message now.");
  });

  it("19c. a caption too long to be a name is truncated rather than refused", async () => {
    const result = await saveSocialPostAction(input({ caption: "b".repeat(400) }));
    expect(result.success).toBe(true);
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.title.length).toBeLessThanOrEqual(120);
  });

  it("20. an update edits the existing rows rather than creating new ones", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue({
      id: CONTENT_ID, status: "DRAFT", deletedAt: null,
      companyId: "company-1", clientId: CLIENT_ID, seoProjectId: PROJECT_ID, socialPost: { id: "social-1" },
    });
    await saveSocialPostAction(input({ contentId: CONTENT_ID, caption: "Revised caption" }));
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
    expect(mockedPrisma.socialPost.create).not.toHaveBeenCalled();
    expect(mockedPrisma.socialPost.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ caption: "Revised caption" }) }));
  });

  it("21. everything is written inside one transaction", async () => {
    await saveSocialPostAction(input());
    expect(mockedPrisma.$transaction).toHaveBeenCalled();
  });

  it("22. the save is recorded in the activity log", async () => {
    await saveSocialPostAction(input());
    expect(mockedLogActivity).toHaveBeenCalledWith(expect.objectContaining({ action: "content.social_post_created", contentId: CONTENT_ID }));
  });
});

describe("validation and links", () => {
  it("23. an empty caption is refused and nothing is written", async () => {
    const result = await saveSocialPostAction(input({ caption: "   " }));
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("24. no title is accepted from the caller — the record names itself", async () => {
    await saveSocialPostAction(input({ caption: "Three things to check before buying." }));
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.title).toBe("Three things to check before buying.");
  });

  it("25. a link goes through the SAME SSRF guard the publishing paths use", async () => {
    await saveSocialPostAction(input({ link: "https://example.com/post" }));
    expect(mockedSafeUrl).toHaveBeenCalledWith("https://example.com/post");
  });

  it("26. a link the guard rejects blocks the save entirely", async () => {
    mockedSafeUrl.mockRejectedValue(new Error("blocked"));
    const result = await saveSocialPostAction(input({ link: "http://169.254.169.254/latest" }));
    expect(result.success).toBe(false);
    expect(!result.success && result.message).toMatch(/not a valid public URL/i);
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("27. no link means the guard is never called and null is stored", async () => {
    await saveSocialPostAction(input({ link: "   " }));
    expect(mockedSafeUrl).not.toHaveBeenCalled();
    const [{ data }] = mockedPrisma.socialPost.create.mock.calls[0];
    expect(data.link).toBeNull();
  });

  it("28. a caption over the strictest SELECTED platform's limit is refused", async () => {
    mockedPrisma.socialAccount.findMany
      .mockResolvedValueOnce([{ id: ACCOUNT_ID, platform: "X", handle: "@acme", displayName: null }]);
    const result = await saveSocialPostAction(input({ caption: "a".repeat(300), accountIds: [ACCOUNT_ID] }));
    expect(result.success).toBe(false);
    expect(!result.success && result.message).toMatch(/X allows 280/);
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("29. the same caption saves fine when no account binds it", async () => {
    expect((await saveSocialPostAction(input({ caption: "a".repeat(300) }))).success).toBe(true);
  });
});

describe("nothing is published, ever", () => {
  it("30. no publishing connection, job or publication is touched", async () => {
    await saveSocialPostAction(input({ schedule: { dateIso: `${YEAR}-09-20`, time: "10:00", timeZone: "UTC" } }));
    expect(mockedPrisma).not.toHaveProperty("publishingJob");
    expect(mockedPrisma).not.toHaveProperty("contentPublication");
  });
});

/* ------------------------------- Phase 7: per-platform captions and links */

const FB_ID = "01a04444-4444-7444-b444-444444444444";
const IG_ID = "01a05555-5555-7555-b555-555555555555";

/** Two live accounts for this project's client — one Facebook page, one Instagram profile. */
function twoAccounts() {
  mockedPrisma.socialAccount.findMany.mockResolvedValueOnce([
    { id: FB_ID, platform: "FACEBOOK", handle: "storagemoguls", displayName: "Storage Moguls" },
    { id: IG_ID, platform: "INSTAGRAM", handle: "@storagemoguls", displayName: null },
  ]);
}

/** The target row written for one account. */
function upsertFor(accountId: string) {
  const call = mockedPrisma.socialPostTarget.upsert.mock.calls.find(([args]) => args.create.socialAccountId === accountId);
  return call?.[0];
}

describe("one post, many accounts, each with its own caption", () => {
  it("31. with no overrides every target stores null — they all follow the shared caption", async () => {
    twoAccounts();
    const result = await saveSocialPostAction(input({ accountIds: [FB_ID, IG_ID] }));
    expect(result.success).toBe(true);
    expect(upsertFor(FB_ID)!.create.caption).toBeNull();
    expect(upsertFor(IG_ID)!.create.caption).toBeNull();
  });

  it("32. a customized target stores ITS OWN caption while the other still inherits", async () => {
    twoAccounts();
    await saveSocialPostAction(
      input({ accountIds: [FB_ID, IG_ID], platformOverrides: { [IG_ID]: { caption: "Swipe for the checklist ✨" } } })
    );
    expect(upsertFor(IG_ID)!.create.caption).toBe("Swipe for the checklist ✨");
    expect(upsertFor(FB_ID)!.create.caption).toBeNull();
  });

  it("33. CHANGING INSTAGRAM DOES NOT CHANGE FACEBOOK — nor the shared caption", async () => {
    twoAccounts();
    await saveSocialPostAction(
      input({
        caption: "The shared caption.",
        accountIds: [FB_ID, IG_ID],
        platformOverrides: { [IG_ID]: { caption: "Instagram only." } },
      })
    );
    expect(upsertFor(IG_ID)!.create.caption).toBe("Instagram only.");
    expect(upsertFor(FB_ID)!.create.caption).toBeNull();
    const [{ data }] = mockedPrisma.socialPost.create.mock.calls[0];
    expect(data.caption).toBe("The shared caption.");
  });

  it("34. resetting a target back to shared WRITES null, so no stale version survives", async () => {
    twoAccounts();
    await saveSocialPostAction(input({ accountIds: [FB_ID, IG_ID], platformOverrides: { [IG_ID]: { caption: null } } }));
    expect(upsertFor(IG_ID)!.update.caption).toBeNull();
  });

  it("35. an override for an account that is NOT selected is dropped with the account", async () => {
    mockedPrisma.socialAccount.findMany.mockResolvedValueOnce([{ id: FB_ID, platform: "FACEBOOK", handle: "sm", displayName: null }]);
    await saveSocialPostAction(input({ accountIds: [FB_ID], platformOverrides: { [IG_ID]: { caption: "Never written" } } }));
    expect(upsertFor(IG_ID)).toBeUndefined();
    expect(mockedPrisma.socialPostTarget.upsert).toHaveBeenCalledTimes(1);
  });

  it("36. an override for ANOTHER CLIENT'S account cannot smuggle in a target", async () => {
    // The scoped query returns only this client's account; the foreign id is
    // simply absent, so nothing keyed to it is ever written.
    mockedPrisma.socialAccount.findMany.mockResolvedValueOnce([{ id: FB_ID, platform: "FACEBOOK", handle: "sm", displayName: null }]);
    const result = await saveSocialPostAction(
      input({ accountIds: [FB_ID, FOREIGN_ACCOUNT_ID], platformOverrides: { [FOREIGN_ACCOUNT_ID]: { caption: "Not mine" } } })
    );
    expect(result.success).toBe(true);
    expect(upsertFor(FOREIGN_ACCOUNT_ID)).toBeUndefined();
    const [{ where }] = mockedPrisma.socialAccount.findMany.mock.calls[0];
    expect(where.companyId).toBe("company-1");
    expect(where.clientId).toBe(CLIENT_ID);
  });
});

describe("per-platform validation is per platform", () => {
  it("37. an over-long INSTAGRAM caption is refused and names Instagram", async () => {
    twoAccounts();
    const result = await saveSocialPostAction(
      input({ accountIds: [FB_ID, IG_ID], platformOverrides: { [IG_ID]: { caption: "a".repeat(2201) } } })
    );
    expect(result.success).toBe(false);
    expect(!result.success && result.message).toMatch(/Instagram allows 2200/);
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("38. the same caption is fine on Facebook, whose limit is far higher", async () => {
    twoAccounts();
    const result = await saveSocialPostAction(
      input({ accountIds: [FB_ID, IG_ID], platformOverrides: { [FB_ID]: { caption: "a".repeat(2201) } } })
    );
    expect(result.success).toBe(true);
  });

  it("39. customizing the strictest platform frees the SHARED caption from its limit", async () => {
    // A shared caption of 300 characters is too long for X while X inherits…
    mockedPrisma.socialAccount.findMany.mockResolvedValueOnce([{ id: ACCOUNT_ID, platform: "X", handle: "@sm", displayName: null }]);
    expect((await saveSocialPostAction(input({ caption: "a".repeat(300), accountIds: [ACCOUNT_ID] }))).success).toBe(false);

    // …and acceptable once X has a caption of its own, because nothing else
    // is bound by X's 280 any more.
    mockedPrisma.socialAccount.findMany.mockResolvedValueOnce([{ id: ACCOUNT_ID, platform: "X", handle: "@sm", displayName: null }]);
    const result = await saveSocialPostAction(
      input({ caption: "a".repeat(300), accountIds: [ACCOUNT_ID], platformOverrides: { [ACCOUNT_ID]: { caption: "Short enough for X." } } })
    );
    expect(result.success).toBe(true);
  });
});

describe("a per-platform link is guarded exactly like the shared one", () => {
  it("40. a per-platform link goes through the SAME SSRF guard", async () => {
    twoAccounts();
    await saveSocialPostAction(input({ accountIds: [FB_ID], platformOverrides: { [FB_ID]: { link: "https://example.com/fb" } } }));
    expect(mockedSafeUrl).toHaveBeenCalledWith("https://example.com/fb");
  });

  it("41. a per-platform link the guard rejects blocks the whole save", async () => {
    twoAccounts();
    mockedSafeUrl.mockRejectedValue(new Error("blocked"));
    const result = await saveSocialPostAction(
      input({ accountIds: [FB_ID], platformOverrides: { [FB_ID]: { link: "http://169.254.169.254/latest" } } })
    );
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });
});

/* ------------------------------- content type --------------------------- */

describe("a composer-created record says it is a social post", () => {
  it("42. the created Content row records contentType SOCIAL_POST", async () => {
    await saveSocialPostAction(input());
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.contentType).toBe("SOCIAL_POST");
  });

  it("43. it does so with no SEO project too — the type is not project-derived", async () => {
    await saveSocialPostAction(input({ seoProjectId: undefined }));
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.contentType).toBe("SOCIAL_POST");
    expect(data.seoProjectId).toBeNull();
  });
});
