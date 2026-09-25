import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 10A — the Facebook publisher, with `fetch` stubbed.
 *
 * NO REAL NETWORK CALL. Every Graph response here is one this test wrote —
 * these assert what the publisher SENDS and how it reads back what Meta
 * SAID, never that a real post was ever created. `meta-facebook.provider.ts`
 * already establishes this discipline for connecting; this file is the same
 * discipline for publishing.
 */
vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { metaFacebookPublisher } from "@/features/social/services/publishers/meta-facebook.publisher";

const V = "v26.0";
const TOKEN = "page-access-token-not-real";
const PAGE_ID = "1234567890";

type FetchStub = (url: string, init?: { method?: string; body?: unknown }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

function stubFetchSequence(responses: Array<{ body: unknown; ok?: boolean; status?: number }>) {
  const calls: Array<{ url: string; method?: string; requestBody?: unknown }> = [];
  let call = 0;
  const spy = vi.fn<FetchStub>(async (url, init) => {
    calls.push({ url, method: init?.method, requestBody: init?.body });
    const r = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return { ok: r.ok ?? true, status: r.status ?? 200, text: async () => JSON.stringify(r.body) };
  });
  vi.stubGlobal("fetch", spy);
  return { spy, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("publishing a real post to Facebook's feed", () => {
  it("1. posts to the account's own page feed, with the message and access token in the query string", async () => {
    const { calls } = stubFetchSequence([{ body: { id: "post-1" } }, { body: { permalink_url: "https://facebook.com/1/posts/1" } }]);
    await metaFacebookPublisher.publish({ accessToken: TOKEN, externalId: PAGE_ID, content: "Hello from Cloud Compass", link: null, media: [] });

    const publishCall = calls[0];
    expect(publishCall.method).toBe("POST");
    const url = new URL(publishCall.url);
    expect(url.pathname).toBe(`/${V}/${PAGE_ID}/feed`);
    expect(url.searchParams.get("message")).toBe("Hello from Cloud Compass");
    expect(url.searchParams.get("access_token")).toBe(TOKEN);
    expect(url.searchParams.has("link")).toBe(false);
  });

  it("2. an optional link is included when given", async () => {
    const { calls } = stubFetchSequence([{ body: { id: "post-1" } }, { body: { permalink_url: null } }]);
    await metaFacebookPublisher.publish({ accessToken: TOKEN, externalId: PAGE_ID, content: "Check this out", link: "https://example.test/article", media: [] });
    const url = new URL(calls[0].url);
    expect(url.searchParams.get("link")).toBe("https://example.test/article");
  });

  it("3. success reads the real external post id Meta returned — never fabricated", async () => {
    stubFetchSequence([{ body: { id: "post-real-id-42" } }, { body: { permalink_url: "https://facebook.com/1/posts/post-real-id-42" } }]);
    const result = await metaFacebookPublisher.publish({ accessToken: TOKEN, externalId: PAGE_ID, content: "x", link: null, media: [] });
    expect(result.ok).toBe(true);
    expect(result.ok && result.result.externalPostId).toBe("post-real-id-42");
  });

  it("4. the permalink is fetched with a documented follow-up GET, and only THAT value is used as externalUrl", async () => {
    const { calls } = stubFetchSequence([{ body: { id: "post-1" } }, { body: { permalink_url: "https://www.facebook.com/1/posts/1" } }]);
    const result = await metaFacebookPublisher.publish({ accessToken: TOKEN, externalId: PAGE_ID, content: "x", link: null, media: [] });

    expect(result.ok && result.result.externalUrl).toBe("https://www.facebook.com/1/posts/1");
    const permalinkCall = calls[1];
    const url = new URL(permalinkCall.url);
    expect(url.pathname).toBe(`/${V}/post-1`);
    expect(url.searchParams.get("fields")).toBe("permalink_url");
    expect(url.searchParams.get("access_token")).toBe(TOKEN);
  });

  it("5. a missing permalink leaves externalUrl null — never a guessed URL pattern", async () => {
    stubFetchSequence([{ body: { id: "post-1" } }, { body: {} }]);
    const result = await metaFacebookPublisher.publish({ accessToken: TOKEN, externalId: PAGE_ID, content: "x", link: null, media: [] });
    expect(result.ok && result.result.externalUrl).toBeNull();
  });

  it("6. a failed permalink read does NOT undo a successful post — the post already exists", async () => {
    stubFetchSequence([{ body: { id: "post-1" } }, { body: { error: { message: "temporary" } }, ok: false, status: 500 }]);
    const result = await metaFacebookPublisher.publish({ accessToken: TOKEN, externalId: PAGE_ID, content: "x", link: null, media: [] });
    expect(result.ok).toBe(true);
    expect(result.ok && result.result.externalPostId).toBe("post-1");
    expect(result.ok && result.result.externalUrl).toBeNull();
  });

  it("7. Meta rejecting the post surfaces the real error code, never the raw provider message", async () => {
    stubFetchSequence([{ body: { error: { message: "Invalid OAuth access token.", code: 190 } }, ok: false, status: 400 }]);
    const result = await metaFacebookPublisher.publish({ accessToken: TOKEN, externalId: PAGE_ID, content: "x", link: null, media: [] });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.message).not.toMatch(/Invalid OAuth access token/);
    expect(!result.ok && result.failure.message).toContain("190");
    expect(!result.ok && result.failure.logDetail).toMatch(/190/);
  });

  it("7b. an OAuthException is reported as an account authorization problem, never an invented content-specific reason", async () => {
    stubFetchSequence([
      {
        body: { error: { message: "Cannot call API for app 123 on behalf of user 456", type: "OAuthException", code: 200, fbtrace_id: "AbCdEf" } },
        ok: false,
        status: 400,
      },
    ]);
    const result = await metaFacebookPublisher.publish({ accessToken: TOKEN, externalId: PAGE_ID, content: "x", link: null, media: [] });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.message).toMatch(/authorization problem/i);
    expect(!result.ok && result.failure.message).toContain("200");
    expect(!result.ok && result.failure.message).not.toMatch(/Cannot call API|behalf of user/);
    expect(!result.ok && result.failure.logDetail).toMatch(/OAuthException/);
  });

  it("8. a response with no id is treated as a failure, never invented as success", async () => {
    stubFetchSequence([{ body: { success: true } }]);
    const result = await metaFacebookPublisher.publish({ accessToken: TOKEN, externalId: PAGE_ID, content: "x", link: null, media: [] });
    expect(result.ok).toBe(false);
  });

  it("9. video is refused outright rather than silently dropped, and no request is ever sent", async () => {
    const { spy } = stubFetchSequence([{ body: { id: "post-1" } }]);
    const result = await metaFacebookPublisher.publish({
      accessToken: TOKEN,
      externalId: PAGE_ID,
      content: "x",
      link: null,
      media: [{ kind: "VIDEO", buffer: Buffer.from("fake-video-bytes"), mimeType: "video/mp4", fileName: "clip.mp4" }],
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.code).toBe("MEDIA_NOT_SUPPORTED");
    expect(spy).not.toHaveBeenCalled();
  });

  it("9b. more than one media item is refused outright, and no request is ever sent", async () => {
    const { spy } = stubFetchSequence([{ body: { id: "post-1" } }]);
    const oneImage = { kind: "IMAGE" as const, buffer: Buffer.from("fake-image-bytes"), mimeType: "image/png", fileName: "a.png" };
    const result = await metaFacebookPublisher.publish({
      accessToken: TOKEN,
      externalId: PAGE_ID,
      content: "x",
      link: null,
      media: [oneImage, oneImage],
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.code).toBe("MEDIA_NOT_SUPPORTED");
    expect(spy).not.toHaveBeenCalled();
  });

  it("10. the access token is never present in a failure's user-facing message", async () => {
    stubFetchSequence([{ body: { error: { message: `bad token ${TOKEN}` } }, ok: false, status: 400 }]);
    const result = await metaFacebookPublisher.publish({ accessToken: TOKEN, externalId: PAGE_ID, content: "x", link: null, media: [] });
    expect(!result.ok && result.failure.message).not.toContain(TOKEN);
  });
});

/**
 * Stage 2 — publishing one image, via the Page's `photos` edge.
 *
 * Same discipline as the text-only suite above: `fetch` is stubbed, nothing
 * here proves a real photo was ever posted — it proves this file builds the
 * documented request shape and reads back what Meta said, honestly.
 */
describe("publishing a real image to Facebook", () => {
  const IMAGE: import("@/features/social/services/social-publisher").PublishMediaInput = {
    kind: "IMAGE",
    buffer: Buffer.from("fake-image-bytes"),
    mimeType: "image/png",
    fileName: "storefront.png",
  };

  it("11. posts to the page's own photos edge, with caption (not message) and the token in the query string, and the image as a real multipart part", async () => {
    const { calls } = stubFetchSequence([{ body: { id: "photo-1", post_id: "page_1_post_1" } }, { body: { permalink_url: "https://facebook.com/1/posts/1" } }]);
    await metaFacebookPublisher.publish({ accessToken: TOKEN, externalId: PAGE_ID, content: "A real storefront photo", link: null, media: [IMAGE] });

    const publishCall = calls[0];
    expect(publishCall.method).toBe("POST");
    const url = new URL(publishCall.url);
    expect(url.pathname).toBe(`/${V}/${PAGE_ID}/photos`);
    expect(url.searchParams.get("caption")).toBe("A real storefront photo");
    expect(url.searchParams.get("access_token")).toBe(TOKEN);
    expect(url.searchParams.has("message")).toBe(false);

    expect(publishCall.requestBody).toBeInstanceOf(FormData);
    const source = (publishCall.requestBody as FormData).get("source");
    expect(source).toBeInstanceOf(Blob);
    expect((source as Blob).type).toBe("image/png");
  });

  it("12. a link alongside an image is appended to the caption, never silently dropped (the photos edge has no link parameter)", async () => {
    const { calls } = stubFetchSequence([{ body: { id: "photo-1", post_id: "page_1_post_1" } }, { body: {} }]);
    await metaFacebookPublisher.publish({ accessToken: TOKEN, externalId: PAGE_ID, content: "Check this out", link: "https://example.test/article", media: [IMAGE] });
    const url = new URL(calls[0].url);
    expect(url.searchParams.get("caption")).toBe("Check this out\n\nhttps://example.test/article");
  });

  it("13. success reads post_id as the real external post id — never the photo's own id, never fabricated", async () => {
    stubFetchSequence([{ body: { id: "photo-999", post_id: "page_1_post_999" } }, { body: { permalink_url: "https://facebook.com/1/posts/999" } }]);
    const result = await metaFacebookPublisher.publish({ accessToken: TOKEN, externalId: PAGE_ID, content: "x", link: null, media: [IMAGE] });
    expect(result.ok).toBe(true);
    expect(result.ok && result.result.externalPostId).toBe("page_1_post_999");
  });

  it("14. the real permalink is fetched via the same documented follow-up GET used for text posts", async () => {
    const { calls } = stubFetchSequence([{ body: { post_id: "page_1_post_1" } }, { body: { permalink_url: "https://www.facebook.com/1/posts/1" } }]);
    const result = await metaFacebookPublisher.publish({ accessToken: TOKEN, externalId: PAGE_ID, content: "x", link: null, media: [IMAGE] });
    expect(result.ok && result.result.externalUrl).toBe("https://www.facebook.com/1/posts/1");
    const permalinkCall = calls[1];
    const url = new URL(permalinkCall.url);
    expect(url.pathname).toBe(`/${V}/page_1_post_1`);
    expect(url.searchParams.get("fields")).toBe("permalink_url");
  });

  it("15. a missing post_id is a failure, never invented as success — the caption is never published alone while claiming the image went too", async () => {
    stubFetchSequence([{ body: { id: "photo-1" } }]);
    const result = await metaFacebookPublisher.publish({ accessToken: TOKEN, externalId: PAGE_ID, content: "x", link: null, media: [IMAGE] });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.code).toBe("PROVIDER_REJECTED");
  });

  it("16. Facebook rejecting the image surfaces the real error code, never the raw provider message", async () => {
    stubFetchSequence([{ body: { error: { message: "Invalid image format.", code: 100 } }, ok: false, status: 400 }]);
    const result = await metaFacebookPublisher.publish({ accessToken: TOKEN, externalId: PAGE_ID, content: "x", link: null, media: [IMAGE] });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.message).not.toMatch(/Invalid image format/);
    expect(!result.ok && result.failure.message).toContain("100");
    expect(!result.ok && result.failure.logDetail).toMatch(/100/);
  });

  it("16b. an OAuthException on the photos edge is reported as an account problem, not an image-format problem", async () => {
    stubFetchSequence([
      { body: { error: { message: "Cannot call API for app 123 on behalf of user 456", type: "OAuthException", code: 200 } }, ok: false, status: 400 },
    ]);
    const result = await metaFacebookPublisher.publish({ accessToken: TOKEN, externalId: PAGE_ID, content: "x", link: null, media: [IMAGE] });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.message).toMatch(/authorization problem/i);
    expect(!result.ok && result.failure.message).not.toMatch(/image/i);
  });

  it("17. the access token never appears in an image-publish failure's user-facing message", async () => {
    stubFetchSequence([{ body: { error: { message: `bad token ${TOKEN}` } }, ok: false, status: 400 }]);
    const result = await metaFacebookPublisher.publish({ accessToken: TOKEN, externalId: PAGE_ID, content: "x", link: null, media: [IMAGE] });
    expect(!result.ok && result.failure.message).not.toContain(TOKEN);
  });
});

/**
 * First Comment — `POST /{page-post-id}/comments`, a SEPARATE operation from
 * either publish path above. `publishComment` is exposed on the exported
 * publisher object alongside `publish`, exactly as `SocialPublisher` declares
 * it — never a second, parallel publishing system.
 */
describe("publishing a first comment to Facebook", () => {
  const POST_ID = "page_1_post_1";
  // Non-null: the real publisher always implements this — the tests are proving its behavior, not its presence.
  const publishComment = metaFacebookPublisher.publishComment!;

  it("18. posts to the post's own comments edge, with message (not caption) and the token in the query string", async () => {
    const { calls } = stubFetchSequence([{ body: { id: "comment-1" } }]);
    await publishComment({ accessToken: TOKEN, externalPostId: POST_ID, comment: "First!" });

    const call = calls[0];
    expect(call.method).toBe("POST");
    const url = new URL(call.url);
    expect(url.pathname).toBe(`/${V}/${POST_ID}/comments`);
    expect(url.searchParams.get("message")).toBe("First!");
    expect(url.searchParams.get("access_token")).toBe(TOKEN);
    expect(url.searchParams.has("caption")).toBe(false);
  });

  it("19. success reads the real external comment id Meta returned — never fabricated", async () => {
    stubFetchSequence([{ body: { id: "comment-real-42" } }]);
    const result = await publishComment({ accessToken: TOKEN, externalPostId: POST_ID, comment: "First!" });
    expect(result.ok).toBe(true);
    expect(result.ok && result.result.externalCommentId).toBe("comment-real-42");
  });

  it("20. a response with no id is a failure, never invented as success", async () => {
    stubFetchSequence([{ body: { success: true } }]);
    const result = await publishComment({ accessToken: TOKEN, externalPostId: POST_ID, comment: "First!" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.code).toBe("PROVIDER_REJECTED");
  });

  it("21. Meta rejecting the comment surfaces the real error code, never the raw provider message", async () => {
    stubFetchSequence([{ body: { error: { message: "Comments are disabled for this post.", code: 100 } }, ok: false, status: 400 }]);
    const result = await publishComment({ accessToken: TOKEN, externalPostId: POST_ID, comment: "First!" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.message).not.toMatch(/Comments are disabled/);
    expect(!result.ok && result.failure.message).toContain("100");
    expect(!result.ok && result.failure.logDetail).toMatch(/100/);
  });

  it("22. an OAuthException is reported as an account authorization problem, not an invented comment-specific reason", async () => {
    stubFetchSequence([
      { body: { error: { message: "Cannot call API for app 123 on behalf of user 456", type: "OAuthException", code: 200 } }, ok: false, status: 400 },
    ]);
    const result = await publishComment({ accessToken: TOKEN, externalPostId: POST_ID, comment: "First!" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.message).toMatch(/authorization problem/i);
  });

  it("23. the access token never appears in a comment-publish failure's user-facing message", async () => {
    stubFetchSequence([{ body: { error: { message: `bad token ${TOKEN}` } }, ok: false, status: 400 }]);
    const result = await publishComment({ accessToken: TOKEN, externalPostId: POST_ID, comment: "First!" });
    expect(!result.ok && result.failure.message).not.toContain(TOKEN);
  });
});
