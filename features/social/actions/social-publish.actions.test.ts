import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 10A — the one action that actually contacts a real platform.
 *
 * Every test here is either a multi-tenant boundary (another company's or
 * client's content/account cannot be published through), a state boundary
 * (only a genuinely CONNECTED account may be published to, only a real
 * publisher may be invoked), or a leak boundary (the access token never
 * appears in the return value or the activity log, whether the publish
 * succeeds or fails).
 *
 * The publisher itself is stubbed — this file is about everything AROUND the
 * provider call, not the call itself (that is meta-facebook.publisher.test.ts).
 */
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/features/content-workspace/services/content-location", () => ({
  contentRevalidatePaths: vi.fn(() => []),
}));
vi.mock("@/features/social/services/social-credential.service", () => ({
  readAccessToken: vi.fn(),
}));
vi.mock("@/features/social/services/social-publisher-registry", () => ({
  socialPublisherFor: vi.fn(),
}));
vi.mock("@/lib/storage", () => ({ storage: { read: vi.fn() } }));

type MockPrisma = {
  socialPostTarget: { findUnique: ReturnType<typeof vi.fn> };
  socialPublication: { upsert: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  socialComment: { findUnique: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  file: { findMany: ReturnType<typeof vi.fn> };
  content: { update: ReturnType<typeof vi.fn> };
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialPostTarget: { findUnique: vi.fn() },
    socialPublication: { upsert: vi.fn(), update: vi.fn() },
    socialComment: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    file: { findMany: vi.fn() },
    content: { update: vi.fn() },
  },
}));

import { publishSocialPostTargetAction } from "@/features/social/actions/social-publish.actions";
import { readAccessToken } from "@/features/social/services/social-credential.service";
import { socialPublisherFor } from "@/features/social/services/social-publisher-registry";
import { logActivity } from "@/lib/activity";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { storage } from "@/lib/storage";

const mockedPrisma = prisma as unknown as MockPrisma;
const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedLogActivity = logActivity as unknown as ReturnType<typeof vi.fn>;
const mockedReadAccessToken = readAccessToken as unknown as ReturnType<typeof vi.fn>;
const mockedPublisherFor = socialPublisherFor as unknown as ReturnType<typeof vi.fn>;
const mockedStorageRead = storage.read as unknown as ReturnType<typeof vi.fn>;

const TARGET_ID = "01a00001-0001-7001-b001-000000000001";
const CONTENT_ID = "01a00002-0002-7002-b002-000000000002";
const ACCOUNT_ID = "01a00003-0003-7003-b003-000000000003";
const CLIENT_ID = "01a00004-0004-7004-b004-000000000004";
const REAL_TOKEN = "ACCESS-TOKEN-must-never-leak";

const MANAGER = { id: "user-1", companyId: "company-1", role: "MANAGER" };
const EMPLOYEE = { id: "user-2", companyId: "company-1", role: "EMPLOYEE" };

function connectedTargetRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: TARGET_ID,
    caption: null,
    link: null,
    firstComment: null,
    socialPost: {
      caption: "A real caption for a real post.",
      link: null,
      firstComment: null,
      content: { id: CONTENT_ID, companyId: "company-1", clientId: CLIENT_ID, deletedAt: null },
    },
    socialAccount: {
      id: ACCOUNT_ID,
      companyId: "company-1",
      clientId: CLIENT_ID,
      platform: "FACEBOOK",
      externalId: "1234567890",
      status: "ACTIVE",
      connectionState: "CONNECTED",
      deletedAt: null,
      displayName: "Storage Moguls",
      handle: "@storagemoguls",
    },
    ...overrides,
  };
}

const mockedPublish = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequireUser.mockResolvedValue(MANAGER);
  mockedPrisma.socialPostTarget.findUnique.mockResolvedValue(connectedTargetRow());
  mockedPrisma.socialPublication.upsert.mockResolvedValue({});
  mockedPrisma.socialPublication.update.mockResolvedValue({});
  mockedPrisma.socialComment.findUnique.mockResolvedValue(null);
  mockedPrisma.socialComment.upsert.mockResolvedValue({});
  mockedPrisma.socialComment.update.mockResolvedValue({});
  mockedPrisma.file.findMany.mockResolvedValue([]);
  mockedPrisma.content.update.mockResolvedValue({});
  mockedReadAccessToken.mockResolvedValue(REAL_TOKEN);
  mockedPublisherFor.mockReturnValue({ platform: "FACEBOOK", publish: mockedPublish });
  mockedPublish.mockResolvedValue({ ok: true, result: { externalPostId: "post-999", externalUrl: "https://facebook.com/post-999" } });
});

describe("who may publish", () => {
  it("1. an employee is refused, and the provider is never contacted", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(result.success).toBe(false);
    expect(!result.success && result.message).toMatch(/do not have permission/i);
    expect(mockedPublish).not.toHaveBeenCalled();
  });
});

describe("a target id from the browser is a claim, not a fact", () => {
  it("2. a malformed id is refused before any query runs", async () => {
    const result = await publishSocialPostTargetAction({ socialPostTargetId: "not-a-uuid" });
    expect(result.success).toBe(false);
    expect(mockedPrisma.socialPostTarget.findUnique).not.toHaveBeenCalled();
  });

  it("3. a target that does not exist is refused", async () => {
    mockedPrisma.socialPostTarget.findUnique.mockResolvedValue(null);
    const result = await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(result.success).toBe(false);
    expect(!result.success && result.message).toBe("Social post target not found.");
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("4. another company's content is refused, even though the account row is well-formed", async () => {
    mockedPrisma.socialPostTarget.findUnique.mockResolvedValue(
      connectedTargetRow({
        socialPost: {
          caption: "x",
          link: null,
          content: { id: CONTENT_ID, companyId: "company-2", clientId: CLIENT_ID, deletedAt: null },
        },
      })
    );
    const result = await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(result.success).toBe(false);
    expect(!result.success && result.message).toBe("Social post target not found.");
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("5. another company's account is refused, even though the content row is well-formed", async () => {
    mockedPrisma.socialPostTarget.findUnique.mockResolvedValue(
      connectedTargetRow({ socialAccount: { ...connectedTargetRow().socialAccount, companyId: "company-2" } })
    );
    const result = await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(result.success).toBe(false);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("6. a target whose content and account disagree on client is refused (cross-client corruption guard)", async () => {
    mockedPrisma.socialPostTarget.findUnique.mockResolvedValue(
      connectedTargetRow({ socialAccount: { ...connectedTargetRow().socialAccount, clientId: "01a00009-0009-7009-b009-000000000009" } })
    );
    const result = await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(result.success).toBe(false);
    expect(mockedPublish).not.toHaveBeenCalled();
  });
});

describe("state that must hold before a real provider is ever contacted", () => {
  it("7. trashed content is refused", async () => {
    mockedPrisma.socialPostTarget.findUnique.mockResolvedValue(
      connectedTargetRow({
        socialPost: {
          caption: "x",
          link: null,
          content: { id: CONTENT_ID, companyId: "company-1", clientId: CLIENT_ID, deletedAt: new Date() },
        },
      })
    );
    const result = await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(result.success).toBe(false);
    expect(!result.success && result.message).toMatch(/trash/i);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("8. a soft-deleted account is refused", async () => {
    mockedPrisma.socialPostTarget.findUnique.mockResolvedValue(
      connectedTargetRow({ socialAccount: { ...connectedTargetRow().socialAccount, deletedAt: new Date() } })
    );
    const result = await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(result.success).toBe(false);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("9. an account the user switched off (status DISCONNECTED) is refused", async () => {
    mockedPrisma.socialPostTarget.findUnique.mockResolvedValue(
      connectedTargetRow({ socialAccount: { ...connectedTargetRow().socialAccount, status: "DISCONNECTED" } })
    );
    const result = await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(result.success).toBe(false);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("10. NOT_CONNECTED is refused — writing/scheduling never required a real connection, publishing does", async () => {
    mockedPrisma.socialPostTarget.findUnique.mockResolvedValue(
      connectedTargetRow({ socialAccount: { ...connectedTargetRow().socialAccount, connectionState: "NOT_CONNECTED" } })
    );
    const result = await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(result.success).toBe(false);
    expect(!result.success && result.message).toMatch(/not connected/i);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("11. NEEDS_RECONNECT is refused the same way CONNECTED's absence always is", async () => {
    mockedPrisma.socialPostTarget.findUnique.mockResolvedValue(
      connectedTargetRow({ socialAccount: { ...connectedTargetRow().socialAccount, connectionState: "NEEDS_RECONNECT" } })
    );
    const result = await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(result.success).toBe(false);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("12. CONNECTED with no externalId (should never happen, but is not trusted) is refused", async () => {
    mockedPrisma.socialPostTarget.findUnique.mockResolvedValue(
      connectedTargetRow({ socialAccount: { ...connectedTargetRow().socialAccount, externalId: null } })
    );
    const result = await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(result.success).toBe(false);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("13. a platform with no real publisher is refused, never silently treated as success", async () => {
    mockedPublisherFor.mockReturnValue(null);
    const result = await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(result.success).toBe(false);
    expect(!result.success && result.message).toMatch(/not implemented/i);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("14. a credential that cannot be decrypted or is missing is refused, and the provider is never called", async () => {
    mockedReadAccessToken.mockResolvedValue(null);
    const result = await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(result.success).toBe(false);
    expect(!result.success && result.message).toMatch(/reconnect/i);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("15. empty effective content is refused before any provider call", async () => {
    mockedPrisma.socialPostTarget.findUnique.mockResolvedValue(
      connectedTargetRow({ caption: "   ", socialPost: { caption: "   ", link: null, content: connectedTargetRow().socialPost.content } })
    );
    const result = await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(result.success).toBe(false);
    expect(mockedPublish).not.toHaveBeenCalled();
  });
});

describe("a real publish attempt, success and failure alike", () => {
  it("16. success writes PUBLISHED with the provider's own id and url, and returns it as data (not an error)", async () => {
    const result = await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual({
      status: "PUBLISHED",
      externalPostId: "post-999",
      externalUrl: "https://facebook.com/post-999",
    });
    expect(mockedPrisma.socialPublication.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { socialPostTargetId: TARGET_ID },
        data: expect.objectContaining({ status: "PUBLISHED", externalPostId: "post-999", externalUrl: "https://facebook.com/post-999" }),
      })
    );
  });

  it("17. a provider rejection is ALSO a successful action call — status FAILED, not ActionResult failure", async () => {
    mockedPublish.mockResolvedValue({ ok: false, failure: { code: "PROVIDER_REJECTED", message: "Facebook did not accept this post." } });
    const result = await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual({ status: "FAILED", failureCode: "PROVIDER_REJECTED", failureMessage: "Facebook did not accept this post." });
    expect(mockedPrisma.socialPublication.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED", failureCode: "PROVIDER_REJECTED" }) })
    );
  });

  it("18. a PUBLISHING marker is written before the provider is ever called", async () => {
    await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(mockedPrisma.socialPublication.upsert.mock.invocationCallOrder[0]).toBeLessThan(mockedPublish.mock.invocationCallOrder[0]);
  });

  it("19. the publisher receives the decrypted token and the account's real externalId, never a company/client id", async () => {
    await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(mockedPublish).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: REAL_TOKEN, externalId: "1234567890" })
    );
  });

  it("20. the access token never appears in the returned result, on success or failure", async () => {
    const success = await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(JSON.stringify(success)).not.toContain(REAL_TOKEN);

    mockedPublish.mockResolvedValue({ ok: false, failure: { code: "PROVIDER_REJECTED", message: "declined", logDetail: REAL_TOKEN } });
    const failure = await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(JSON.stringify(failure)).not.toContain(REAL_TOKEN);
  });

  it("21. the activity log records only public facts — platform, account id, external id/failure code — never the token", async () => {
    await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(JSON.stringify(mockedLogActivity.mock.calls)).not.toContain(REAL_TOKEN);
    expect(mockedLogActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "content.social_post_published", companyId: "company-1", clientId: CLIENT_ID, contentId: CONTENT_ID })
    );

    mockedLogActivity.mockClear();
    mockedPublish.mockResolvedValue({ ok: false, failure: { code: "PROVIDER_REJECTED", message: "declined" } });
    await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(mockedLogActivity).toHaveBeenCalledWith(expect.objectContaining({ action: "content.social_post_publish_failed" }));
  });

  it("22. a customized target's own caption/link win over the shared post's", async () => {
    mockedPrisma.socialPostTarget.findUnique.mockResolvedValue(
      connectedTargetRow({ caption: "this account's own caption", link: "https://example.test/own-link" })
    );
    await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(mockedPublish).toHaveBeenCalledWith(
      expect.objectContaining({ content: "this account's own caption", link: "https://example.test/own-link" })
    );
  });

  it("23. an inheriting target (null caption/link) falls back to the shared post's own values", async () => {
    await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(mockedPublish).toHaveBeenCalledWith(expect.objectContaining({ content: "A real caption for a real post." }));
  });
});

/**
 * Stage 2 — resolving the post's attached image entirely server-side, from
 * the target's own already-ownership-checked Content row. There is no File
 * id anywhere in this action's input, so there is nothing for a browser to
 * substitute another company's or client's file into — these tests prove
 * that by construction (the query is always scoped to `content.id`), not by
 * trying every possible tampered id.
 */
describe("Stage 2 — resolving and publishing the post's own image", () => {
  const IMAGE_FILE = { id: "file-1", url: "storage-key-1.png", mimeType: "image/png", fileName: "storefront.png" };
  const IMAGE_BYTES = Buffer.from("fake-image-bytes");

  it("24. exactly one attached image is read from storage and passed to the publisher", async () => {
    mockedPrisma.file.findMany.mockResolvedValue([IMAGE_FILE]);
    mockedStorageRead.mockResolvedValue(IMAGE_BYTES);

    await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });

    expect(mockedPrisma.file.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { contentId: CONTENT_ID, deletedAt: null } })
    );
    expect(mockedStorageRead).toHaveBeenCalledWith("storage-key-1.png");
    expect(mockedPublish).toHaveBeenCalledWith(
      expect.objectContaining({ media: [{ kind: "IMAGE", buffer: IMAGE_BYTES, mimeType: "image/png", fileName: "storefront.png" }] })
    );
  });

  it("25. the file query is always scoped to this target's own content id — never a browser-suppliable value", async () => {
    mockedPrisma.file.findMany.mockResolvedValue([]);
    await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    const where = mockedPrisma.file.findMany.mock.calls[0][0].where;
    expect(where.contentId).toBe(CONTENT_ID);
  });

  it("26. a video attachment is refused outright — never silently published as text-only", async () => {
    mockedPrisma.file.findMany.mockResolvedValue([{ id: "file-2", url: "k.mp4", mimeType: "video/mp4", fileName: "clip.mp4" }]);
    const result = await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(result.success).toBe(false);
    expect(!result.success && result.message).toMatch(/video/i);
    expect(mockedPublish).not.toHaveBeenCalled();
    expect(mockedPrisma.socialPublication.upsert).not.toHaveBeenCalled();
  });

  it("27. more than one attached image is refused outright — never silently publishing just the first", async () => {
    mockedPrisma.file.findMany.mockResolvedValue([
      IMAGE_FILE,
      { id: "file-3", url: "storage-key-2.png", mimeType: "image/png", fileName: "second.png" },
    ]);
    const result = await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(result.success).toBe(false);
    expect(!result.success && result.message).toMatch(/single image/i);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("28. a storage read failure is refused safely, never crashing and never publishing text-only in its place", async () => {
    mockedPrisma.file.findMany.mockResolvedValue([IMAGE_FILE]);
    mockedStorageRead.mockRejectedValue(new Error("disk read failed"));
    const result = await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(result.success).toBe(false);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("29. a successful image publish still records the real external post id and permalink, exactly like text", async () => {
    mockedPrisma.file.findMany.mockResolvedValue([IMAGE_FILE]);
    mockedStorageRead.mockResolvedValue(IMAGE_BYTES);
    mockedPublish.mockResolvedValue({ ok: true, result: { externalPostId: "page_1_post_42", externalUrl: "https://facebook.com/1/posts/42" } });

    const result = await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(result.success && result.data).toEqual({ status: "PUBLISHED", externalPostId: "page_1_post_42", externalUrl: "https://facebook.com/1/posts/42" });
  });

  it("30. a successful publish moves Content out of SCHEDULED — never left falsely representing a schedule that already happened", async () => {
    mockedPrisma.file.findMany.mockResolvedValue([]);
    await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(mockedPrisma.content.update).toHaveBeenCalledWith({
      where: { id: CONTENT_ID },
      data: expect.objectContaining({ status: "PUBLISHED", scheduledAt: null, scheduledTimezone: null }),
    });
  });

  it("31. a failed publish never touches Content's status — nothing external actually happened", async () => {
    mockedPrisma.file.findMany.mockResolvedValue([]);
    mockedPublish.mockResolvedValue({ ok: false, failure: { code: "PROVIDER_REJECTED", message: "declined" } });
    await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
  });

  it("32. no access token appears in the returned result or the activity log for an image publish, success or failure", async () => {
    mockedPrisma.file.findMany.mockResolvedValue([IMAGE_FILE]);
    mockedStorageRead.mockResolvedValue(IMAGE_BYTES);

    const success = await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(JSON.stringify(success)).not.toContain(REAL_TOKEN);
    expect(JSON.stringify(mockedLogActivity.mock.calls)).not.toContain(REAL_TOKEN);

    mockedPublish.mockResolvedValue({ ok: false, failure: { code: "PROVIDER_REJECTED", message: "declined", logDetail: REAL_TOKEN } });
    const failure = await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(JSON.stringify(failure)).not.toContain(REAL_TOKEN);
  });
});

/**
 * First Comment — a SEPARATE operation from the post itself, only ever
 * attempted once a real post id exists. `mockedPublishComment` is attached to
 * the SAME publisher object `publish` lives on, exactly as the real
 * `SocialPublisher.publishComment` sits alongside `publish`.
 */
describe("First Comment — a separate operation from the post itself", () => {
  const mockedPublishComment = vi.fn();

  beforeEach(() => {
    mockedPublisherFor.mockReturnValue({ platform: "FACEBOOK", publish: mockedPublish, publishComment: mockedPublishComment });
    mockedPublishComment.mockReset();
    mockedPublishComment.mockResolvedValue({ ok: true, result: { externalCommentId: "comment-1" } });
  });

  it("33. no comment is attempted, and `comment` is absent (not null), when nothing was written", async () => {
    const result = await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(result.success && result.data).toEqual({ status: "PUBLISHED", externalPostId: "post-999", externalUrl: "https://facebook.com/post-999" });
    expect(result.success && "comment" in result.data).toBe(false);
    expect(mockedPublishComment).not.toHaveBeenCalled();
  });

  it("34. post succeeds + comment succeeds — both report PUBLISHED, and the comment is published against the real post id", async () => {
    mockedPrisma.socialPostTarget.findUnique.mockResolvedValue(
      connectedTargetRow({ socialPost: { caption: "A real caption.", link: null, firstComment: "First!", content: { id: CONTENT_ID, companyId: "company-1", clientId: CLIENT_ID, deletedAt: null } } })
    );
    const result = await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(result.success && result.data).toEqual({
      status: "PUBLISHED",
      externalPostId: "post-999",
      externalUrl: "https://facebook.com/post-999",
      comment: { status: "PUBLISHED", externalCommentId: "comment-1" },
    });
    expect(mockedPublishComment).toHaveBeenCalledWith({ accessToken: REAL_TOKEN, externalPostId: "post-999", comment: "First!" });
  });

  it("35. post succeeds + comment fails — the post stays PUBLISHED, and the real Meta failure is reported for the comment alone", async () => {
    mockedPrisma.socialPostTarget.findUnique.mockResolvedValue(
      connectedTargetRow({ socialPost: { caption: "A real caption.", link: null, firstComment: "First!", content: { id: CONTENT_ID, companyId: "company-1", clientId: CLIENT_ID, deletedAt: null } } })
    );
    mockedPublishComment.mockResolvedValue({ ok: false, failure: { code: "PROVIDER_REJECTED", message: "Facebook rejected the comment. Meta error code: 200." } });
    const result = await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(result.success && result.data).toEqual({
      status: "PUBLISHED",
      externalPostId: "post-999",
      externalUrl: "https://facebook.com/post-999",
      comment: { status: "FAILED", failureCode: "PROVIDER_REJECTED", failureMessage: "Facebook rejected the comment. Meta error code: 200." },
    });
    expect(mockedPrisma.content.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PUBLISHED" }) }));
  });

  it("36. post fails — the comment is reported NOT_ATTEMPTED, and Meta is never asked about it", async () => {
    mockedPrisma.socialPostTarget.findUnique.mockResolvedValue(
      connectedTargetRow({ socialPost: { caption: "A real caption.", link: null, firstComment: "First!", content: { id: CONTENT_ID, companyId: "company-1", clientId: CLIENT_ID, deletedAt: null } } })
    );
    mockedPublish.mockResolvedValue({ ok: false, failure: { code: "PROVIDER_REJECTED", message: "declined" } });
    const result = await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(result.success && result.data).toEqual({
      status: "FAILED",
      failureCode: "PROVIDER_REJECTED",
      failureMessage: "declined",
      comment: { status: "NOT_ATTEMPTED" },
    });
    expect(mockedPublishComment).not.toHaveBeenCalled();
  });

  it("37. a retry never creates a duplicate comment — an already-PUBLISHED comment is reused without calling Meta again", async () => {
    mockedPrisma.socialPostTarget.findUnique.mockResolvedValue(
      connectedTargetRow({ socialPost: { caption: "A real caption.", link: null, firstComment: "First!", content: { id: CONTENT_ID, companyId: "company-1", clientId: CLIENT_ID, deletedAt: null } } })
    );
    mockedPrisma.socialComment.findUnique.mockResolvedValue({ status: "PUBLISHED", externalCommentId: "already-there" });
    const result = await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(result.success && result.data).toMatchObject({ comment: { status: "PUBLISHED", externalCommentId: "already-there" } });
    expect(mockedPublishComment).not.toHaveBeenCalled();
    expect(mockedPrisma.socialComment.upsert).not.toHaveBeenCalled();
  });

  it("38. a platform whose publisher has no publishComment fails honestly, rather than crashing or silently skipping", async () => {
    mockedPublisherFor.mockReturnValue({ platform: "FACEBOOK", publish: mockedPublish });
    mockedPrisma.socialPostTarget.findUnique.mockResolvedValue(
      connectedTargetRow({ socialPost: { caption: "A real caption.", link: null, firstComment: "First!", content: { id: CONTENT_ID, companyId: "company-1", clientId: CLIENT_ID, deletedAt: null } } })
    );
    const result = await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(result.success && result.data).toMatchObject({ comment: { status: "FAILED", failureCode: "NOT_IMPLEMENTED" } });
  });

  it("39. the access token never appears in the result when a comment is published or fails", async () => {
    mockedPrisma.socialPostTarget.findUnique.mockResolvedValue(
      connectedTargetRow({ socialPost: { caption: "A real caption.", link: null, firstComment: "First!", content: { id: CONTENT_ID, companyId: "company-1", clientId: CLIENT_ID, deletedAt: null } } })
    );
    const success = await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(JSON.stringify(success)).not.toContain(REAL_TOKEN);

    mockedPublishComment.mockResolvedValue({ ok: false, failure: { code: "PROVIDER_REJECTED", message: "declined", logDetail: REAL_TOKEN } });
    const failure = await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(JSON.stringify(failure)).not.toContain(REAL_TOKEN);
  });

  it("40. an account's own first-comment override wins over the shared post's", async () => {
    mockedPrisma.socialPostTarget.findUnique.mockResolvedValue(
      connectedTargetRow({
        firstComment: "Override wins",
        socialPost: { caption: "A real caption.", link: null, firstComment: "Shared, ignored", content: { id: CONTENT_ID, companyId: "company-1", clientId: CLIENT_ID, deletedAt: null } },
      })
    );
    await publishSocialPostTargetAction({ socialPostTargetId: TARGET_ID });
    expect(mockedPublishComment).toHaveBeenCalledWith(expect.objectContaining({ comment: "Override wins" }));
  });
});
