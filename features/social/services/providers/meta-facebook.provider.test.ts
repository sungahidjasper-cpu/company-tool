import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 9 / 9B — the Meta provider, with `fetch` stubbed.
 *
 * NO REAL CREDENTIALS AND NO REAL NETWORK CALL. The app id and secret here
 * are obvious fakes, and every Graph response is one this test wrote. That is
 * the point: these assert the provider's own logic — what it sends, what it
 * refuses, what it does when Meta says no — without pretending a connection
 * to Meta ever happened.
 *
 * These are ARCHITECTURE tests. Passing them does not mean a real Meta OAuth
 * connection has ever succeeded; nothing in this repository has performed one.
 */
vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { metaFacebookProvider } from "@/features/social/services/providers/meta-facebook.provider";

const APP_ID = "test-app-id-not-real";
const APP_SECRET = "test-app-secret-not-real";
const REDIRECT_URI = "https://example.test/api/social/connect/facebook/callback";

/** Meta's current version, per its versioning guide. Pinned in the provider. */
const V = "v26.0";

function configure() {
  process.env.FACEBOOK_APP_ID = APP_ID;
  process.env.FACEBOOK_APP_SECRET = APP_SECRET;
}

function unconfigure() {
  delete process.env.FACEBOOK_APP_ID;
  delete process.env.FACEBOOK_APP_SECRET;
}

type FetchStub = (
  url: string,
  init?: { cache?: string }
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/** Stubs the same response for every call. */
function stubFetch(body: unknown, ok = true, status = 200) {
  const spy = vi.fn<FetchStub>(async () => ({ ok, status, text: async () => JSON.stringify(body) }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

/**
 * Stubs a SEQUENCE of responses, which the two-step token exchange and the
 * paged accounts edge both need. Past the end, the last entry repeats.
 */
function stubFetchSequence(responses: Array<{ body: unknown; ok?: boolean; status?: number }>) {
  let call = 0;
  const spy = vi.fn<FetchStub>(async () => {
    const r = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return { ok: r.ok ?? true, status: r.status ?? 200, text: async () => JSON.stringify(r.body) };
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

/** A Page as Meta returns it: id, name, its own token, and the viewer's tasks. */
const page = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  access_token: `page-token-${id}`,
  tasks: ["CREATE_CONTENT", "MANAGE"],
  ...over,
});

/** The happy two-step exchange: short-lived token, then the long-lived one. */
const TWO_STEP = [
  { body: { access_token: "short-lived-user-token" } },
  { body: { access_token: "long-lived-user-token", expires_in: 5184000 } },
];

beforeEach(() => {
  vi.clearAllMocks();
  unconfigure();
});

afterEach(() => {
  vi.unstubAllGlobals();
  unconfigure();
});

describe("with no app credentials, nothing pretends to work", () => {
  it("1. configuration is reported as missing, naming the variables and not their values", () => {
    const configuration = metaFacebookProvider.describeConfiguration();
    expect(configuration.configured).toBe(false);
    expect(!configuration.configured && configuration.missingKeys).toEqual(["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"]);
    expect(!configuration.configured && configuration.summary).toBe("Facebook connection is not configured yet.");
  });

  it("2. a partial configuration is still not configured", () => {
    process.env.FACEBOOK_APP_ID = APP_ID;
    const configuration = metaFacebookProvider.describeConfiguration();
    expect(configuration.configured).toBe(false);
    expect(!configuration.configured && configuration.missingKeys).toEqual(["FACEBOOK_APP_SECRET"]);
  });

  it("3. building an authorization URL throws rather than producing a broken one", () => {
    expect(() => metaFacebookProvider.buildAuthorizationUrl({ state: "s".repeat(40), redirectUri: REDIRECT_URI })).toThrow(
      /not configured/i
    );
  });

  it("4. a code exchange refuses without calling out to anything", async () => {
    const spy = stubFetch({});
    const result = await metaFacebookProvider.exchangeAuthorizationCode({ code: "abc", redirectUri: REDIRECT_URI });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.message).toMatch(/not configured/i);
    expect(spy).not.toHaveBeenCalled();
  });

  it("5. listing pages refuses without calling out to anything", async () => {
    const spy = stubFetch({});
    const result = await metaFacebookProvider.listManageableAccounts({ accessToken: "whatever" });
    expect(result.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("6. resolving a credential refuses without calling out to anything", async () => {
    const spy = stubFetch({});
    const result = await metaFacebookProvider.resolveAccountCredential({ accessToken: "x", externalId: "10001" });
    expect(result.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("the authorization URL", () => {
  beforeEach(configure);

  it("7. points at Meta's documented dialog on the current pinned API version", () => {
    const url = new URL(metaFacebookProvider.buildAuthorizationUrl({ state: "s".repeat(40), redirectUri: REDIRECT_URI }));
    expect(url.origin).toBe("https://www.facebook.com");
    expect(url.pathname).toBe(`/${V}/dialog/oauth`);
  });

  it("8. carries the state, the exact redirect URI and the authorization-code response type", () => {
    const state = "state-value-long-enough-to-be-real";
    const url = new URL(metaFacebookProvider.buildAuthorizationUrl({ state, redirectUri: REDIRECT_URI }));
    expect(url.searchParams.get("state")).toBe(state);
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(APP_ID);
  });

  it("9. NEVER contains the app secret — this URL goes to a browser", () => {
    const built = metaFacebookProvider.buildAuthorizationUrl({ state: "s".repeat(40), redirectUri: REDIRECT_URI });
    expect(built).not.toContain(APP_SECRET);
    expect(built).not.toContain("client_secret");
  });

  it("10. asks for exactly the read + publish + first-comment permissions authorized — nothing wider", () => {
    const url = new URL(metaFacebookProvider.buildAuthorizationUrl({ state: "s".repeat(40), redirectUri: REDIRECT_URI }));
    const scopes = (url.searchParams.get("scope") ?? "").split(",");
    expect(scopes).toEqual(["pages_show_list", "pages_read_engagement", "pages_manage_posts", "pages_manage_engagement"]);
    /*
     * Phase 10A added pages_manage_posts because that phase's own task was
     * real Facebook publishing, and Meta's permission reference names its
     * only dependencies as the two scopes already requested above.
     * First Comment added pages_manage_engagement — Meta's own comments
     * reference documents it as sufficient for POSTING a comment; nothing
     * wider (never pages_read_user_content, never business_management or any
     * ads permission) was added.
     */
  });

  it("11. asks for nothing to do with advertising", () => {
    /* A Page connection is not an ad-account connection. */
    const built = metaFacebookProvider.buildAuthorizationUrl({ state: "s".repeat(40), redirectUri: REDIRECT_URI });
    expect(built).not.toMatch(/ads_management|ads_read|business_management/);
  });
});

describe("exchanging the authorization code", () => {
  beforeEach(configure);

  it("12. sends Meta's documented parameters to the documented endpoint", async () => {
    const spy = stubFetchSequence(TWO_STEP);
    await metaFacebookProvider.exchangeAuthorizationCode({ code: "the-code", redirectUri: REDIRECT_URI });

    const url = new URL(spy.mock.calls[0][0]);
    expect(url.origin).toBe("https://graph.facebook.com");
    expect(url.pathname).toBe(`/${V}/oauth/access_token`);
    expect(url.searchParams.get("code")).toBe("the-code");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("client_secret")).toBe(APP_SECRET);
  });

  it("13. never caches a token exchange", async () => {
    const spy = stubFetchSequence(TWO_STEP);
    await metaFacebookProvider.exchangeAuthorizationCode({ code: "c", redirectUri: REDIRECT_URI });
    expect(spy.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
  });

  /* ---- Phase 9B: the long-lived exchange, without which nothing lasts ---- */

  it("14. ALSO exchanges the short-lived token for a long-lived one", async () => {
    const spy = stubFetchSequence(TWO_STEP);
    await metaFacebookProvider.exchangeAuthorizationCode({ code: "c", redirectUri: REDIRECT_URI });

    expect(spy).toHaveBeenCalledTimes(2);
    const second = new URL(spy.mock.calls[1][0]);
    expect(second.pathname).toBe(`/${V}/oauth/access_token`);
    expect(second.searchParams.get("grant_type")).toBe("fb_exchange_token");
    expect(second.searchParams.get("fb_exchange_token")).toBe("short-lived-user-token");
    expect(second.searchParams.get("client_id")).toBe(APP_ID);
    expect(second.searchParams.get("client_secret")).toBe(APP_SECRET);
  });

  it("15. returns the LONG-LIVED token, never the short-lived one", async () => {
    stubFetchSequence(TWO_STEP);
    const result = await metaFacebookProvider.exchangeAuthorizationCode({ code: "c", redirectUri: REDIRECT_URI });
    expect(result.ok && result.authorization.accessToken).toBe("long-lived-user-token");
    expect(result.ok && result.authorization.accessToken).not.toBe("short-lived-user-token");
  });

  it("16. a FAILED long-lived exchange fails the whole connection", async () => {
    /*
     * Falling back to the short-lived token would produce something that says
     * CONNECTED now and breaks within a couple of hours. Refusing is correct.
     */
    const spy = stubFetchSequence([
      { body: { access_token: "short-lived-user-token" } },
      { body: { error: { message: "cannot exchange" } }, ok: false, status: 400 },
    ]);
    const result = await metaFacebookProvider.exchangeAuthorizationCode({ code: "c", redirectUri: REDIRECT_URI });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.message).toMatch(/lasting connection/i);
  });

  it("17. a long-lived response with no token is a failure, not a silent success", async () => {
    stubFetchSequence([{ body: { access_token: "short-lived-user-token" } }, { body: { token_type: "bearer" } }]);
    const result = await metaFacebookProvider.exchangeAuthorizationCode({ code: "c", redirectUri: REDIRECT_URI });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.message).toMatch(/lasting connection/i);
  });

  it("18. the user-token expiry comes from Meta's own expires_in, in seconds", async () => {
    stubFetchSequence(TWO_STEP);
    const before = Date.now();
    const result = await metaFacebookProvider.exchangeAuthorizationCode({ code: "c", redirectUri: REDIRECT_URI });
    const expiresAt = result.ok ? result.authorization.expiresAt : null;
    expect(expiresAt).toBeInstanceOf(Date);
    /* 5184000s is the ~60 days Meta documents for a long-lived user token. */
    expect(expiresAt!.getTime()).toBeGreaterThanOrEqual(before + 5183999_000);
  });

  it("19. NO expiry is invented when Meta stated none", async () => {
    stubFetchSequence([
      { body: { access_token: "short-lived-user-token" } },
      { body: { access_token: "long-lived-user-token" } },
    ]);
    const result = await metaFacebookProvider.exchangeAuthorizationCode({ code: "c", redirectUri: REDIRECT_URI });
    expect(result.ok && result.authorization.expiresAt).toBeNull();
  });

  it("20. a first response with no token fails before any second call is made", async () => {
    const spy = stubFetchSequence([{ body: { token_type: "bearer" } }]);
    const result = await metaFacebookProvider.exchangeAuthorizationCode({ code: "c", redirectUri: REDIRECT_URI });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.message).toMatch(/did not return an access token/i);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("21. an invalid or reused authorization code is refused", async () => {
    stubFetch({ error: { message: "This authorization code has been used." } }, false, 400);
    const result = await metaFacebookProvider.exchangeAuthorizationCode({ code: "used", redirectUri: REDIRECT_URI });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.message).toMatch(/did not accept this authorization/i);
  });

  it("22. Meta's own error text never reaches the user-facing message", async () => {
    stubFetch({ error: { message: "Invalid verification code format. code=SECRET-ECHO" } }, false, 400);
    const result = await metaFacebookProvider.exchangeAuthorizationCode({ code: "c", redirectUri: REDIRECT_URI });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.message).not.toMatch(/SECRET-ECHO/);
    /* It is kept for the log, where it belongs. */
    expect(!result.ok && result.failure.logDetail).toMatch(/SECRET-ECHO/);
  });

  it("23. a network failure is a refusal, and its detail leaks no secret", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect ETIMEDOUT");
      })
    );
    const result = await metaFacebookProvider.exchangeAuthorizationCode({ code: "c", redirectUri: REDIRECT_URI });
    expect(result.ok).toBe(false);
    /* The token URL holds the app secret, so no detail may echo it. */
    expect(!result.ok && (result.failure.logDetail ?? "")).not.toContain(APP_SECRET);
  });
});

describe("discovering pages", () => {
  beforeEach(configure);

  it("24. reads Meta's documented accounts edge, asking for the fields it uses", async () => {
    const spy = stubFetch({ data: [] });
    await metaFacebookProvider.listManageableAccounts({ accessToken: "user-token" });
    const url = new URL(spy.mock.calls[0][0]);
    expect(url.pathname).toBe(`/${V}/me/accounts`);
    expect(url.searchParams.get("fields")).toBe("id,name,username,access_token,tasks");
  });

  it("25. returns the provider's own ids and names", async () => {
    stubFetch({ data: [page("10001", "Catawba Yaupon"), page("10002", "Storage Moguls")] });
    const result = await metaFacebookProvider.listManageableAccounts({ accessToken: "user-token" });
    expect(result.ok && result.accounts).toEqual([
      { externalId: "10001", name: "Catawba Yaupon", handle: null },
      { externalId: "10002", name: "Storage Moguls", handle: null },
    ]);
  });

  it("26. uses Meta's username as the handle when the Page has one", async () => {
    stubFetch({ data: [page("10001", "Catawba Yaupon", { username: "catawbayaupon" })] });
    const result = await metaFacebookProvider.listManageableAccounts({ accessToken: "user-token" });
    expect(result.ok && result.accounts[0].handle).toBe("catawbayaupon");
  });

  it("27. never derives a handle from the name when Meta gave none", async () => {
    stubFetch({ data: [page("10001", "Catawba Yaupon")] });
    const result = await metaFacebookProvider.listManageableAccounts({ accessToken: "user-token" });
    expect(result.ok && result.accounts[0].handle).toBeNull();
  });

  it("28. a page token is never included in what discovery returns", async () => {
    stubFetch({ data: [page("10001", "Catawba Yaupon")] });
    const result = await metaFacebookProvider.listManageableAccounts({ accessToken: "user-token" });
    expect(JSON.stringify(result)).not.toContain("page-token-10001");
  });

  /* ---- Phase 9B: only Pages the authorization genuinely covers ---- */

  it("29. a Page with NO assigned tasks is excluded — it cannot legitimately be managed", async () => {
    stubFetch({ data: [page("10001", "No Tasks", { tasks: [] }), page("10002", "Real")] });
    const result = await metaFacebookProvider.listManageableAccounts({ accessToken: "user-token" });
    expect(result.ok && result.accounts.map((a) => a.externalId)).toEqual(["10002"]);
  });

  it("30. a Page with no access token of its own is excluded", async () => {
    stubFetch({ data: [{ id: "10001", name: "No Token", tasks: ["MANAGE"] }, page("10002", "Real")] });
    const result = await metaFacebookProvider.listManageableAccounts({ accessToken: "user-token" });
    expect(result.ok && result.accounts.map((a) => a.externalId)).toEqual(["10002"]);
  });

  it("31. malformed entries are skipped rather than guessed at", async () => {
    stubFetch({ data: [{ id: "10001" }, { name: "No id" }, null, "nonsense", page("10002", "Real")] });
    const result = await metaFacebookProvider.listManageableAccounts({ accessToken: "user-token" });
    expect(result.ok && result.accounts).toEqual([{ externalId: "10002", name: "Real", handle: null }]);
  });

  it("32. no pages is an empty list, not an error", async () => {
    stubFetch({ data: [] });
    const result = await metaFacebookProvider.listManageableAccounts({ accessToken: "user-token" });
    expect(result.ok && result.accounts).toEqual([]);
  });

  it("33. Meta's paging is followed, so a long Page list is not silently truncated", async () => {
    const spy = stubFetchSequence([
      { body: { data: [page("1", "One")], paging: { next: "https://graph.facebook.com/next-page-1" } } },
      { body: { data: [page("2", "Two")], paging: { next: "https://graph.facebook.com/next-page-2" } } },
      { body: { data: [page("3", "Three")] } },
    ]);
    const result = await metaFacebookProvider.listManageableAccounts({ accessToken: "user-token" });
    expect(spy).toHaveBeenCalledTimes(3);
    expect(result.ok && result.accounts.map((a) => a.externalId)).toEqual(["1", "2", "3"]);
  });

  it("34. paging is bounded, so a provider looping forever cannot hang a connection", async () => {
    const spy = stubFetch({ data: [page("1", "One")], paging: { next: "https://graph.facebook.com/forever" } });
    const result = await metaFacebookProvider.listManageableAccounts({ accessToken: "user-token" });
    expect(result.ok).toBe(true);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it("35. a duplicate Page across pages is returned once", async () => {
    stubFetchSequence([
      { body: { data: [page("1", "One")], paging: { next: "https://graph.facebook.com/n" } } },
      { body: { data: [page("1", "One again")] } },
    ]);
    const result = await metaFacebookProvider.listManageableAccounts({ accessToken: "user-token" });
    expect(result.ok && result.accounts).toHaveLength(1);
  });

  it("36. a failed Pages call is a refusal with a safe message", async () => {
    stubFetch({ error: { message: "boom" } }, false, 400);
    const result = await metaFacebookProvider.listManageableAccounts({ accessToken: "user-token" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.message).toMatch(/could not list the Pages/i);
  });
});

describe("resolving the credential for a chosen page", () => {
  beforeEach(configure);

  it("37. stores the PAGE's token, not the user token used to find it", async () => {
    stubFetch({ data: [page("10001", "Catawba Yaupon")] });
    const result = await metaFacebookProvider.resolveAccountCredential({ accessToken: "user-token", externalId: "10001" });
    expect(result.ok && result.authorization.accessToken).toBe("page-token-10001");
    expect(result.ok && result.authorization.accessToken).not.toBe("user-token");
  });

  it("38. a page id Meta did not confirm is REFUSED — this is what stops a typed id", async () => {
    stubFetch({ data: [page("10001", "Catawba Yaupon")] });
    const result = await metaFacebookProvider.resolveAccountCredential({
      accessToken: "user-token",
      externalId: "99999-someone-typed-this",
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.message).toMatch(/not one this Facebook account manages/i);
  });

  it("39. a Page the authorization does not really cover is refused, not connected", async () => {
    /* No token and no tasks means the filter drops it, so it is not selectable. */
    stubFetch({ data: [{ id: "10001", name: "Catawba Yaupon", tasks: [] }] });
    const result = await metaFacebookProvider.resolveAccountCredential({ accessToken: "user-token", externalId: "10001" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.message).toMatch(/not one this Facebook account manages/i);
  });

  it("40. a Page token carries no invented expiry — Meta says long-lived Page tokens have none", async () => {
    stubFetch({ data: [page("10001", "Catawba Yaupon")] });
    const result = await metaFacebookProvider.resolveAccountCredential({ accessToken: "user-token", externalId: "10001" });
    expect(result.ok && result.authorization.expiresAt).toBeNull();
  });

  it("41. a failed confirmation is a refusal with a safe message", async () => {
    stubFetch({ error: { message: "boom" } }, false, 400);
    const result = await metaFacebookProvider.resolveAccountCredential({ accessToken: "user-token", externalId: "10001" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.message).toMatch(/could not confirm access/i);
  });

  it("42. never calls anything to do with ad accounts", async () => {
    const spy = stubFetch({ data: [page("10001", "Catawba Yaupon")] });
    await metaFacebookProvider.resolveAccountCredential({ accessToken: "user-token", externalId: "10001" });
    for (const [url] of spy.mock.calls) expect(url).not.toMatch(/adaccount|adaccounts/i);
  });
});
