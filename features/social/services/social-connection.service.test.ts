import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 9 — the connection lifecycle.
 *
 * WHAT THESE PROVE. That CONNECTED is written only after a provider has
 * actually confirmed a page; that a hand-configured account is reattached
 * rather than duplicated; that disconnecting destroys the authorization and
 * keeps the account; and that a failed check is what produces
 * NEEDS_RECONNECT.
 *
 * The provider is a stub whose answers this file writes. That is not a fake
 * OAuth success — no state is redeemed, no token is invented as though Meta
 * issued it, and nothing here is reported as a real connection. It is the
 * seam the architecture defines, exercised on both sides of its contract.
 */
vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

vi.mock("@/features/social/services/social-oauth-state.service", () => ({
  claimPendingAuthorization: vi.fn(),
  clearPendingAuthorization: vi.fn(),
  selectionHashOf: vi.fn(() => "selection-hash"),
}));

vi.mock("@/features/social/services/social-credential.service", () => ({
  storeSocialCredential: vi.fn(),
  readAccessToken: vi.fn(),
  deleteSocialCredential: vi.fn(),
}));

vi.mock("@/features/social/services/social-provider-registry", () => ({ socialProviderFor: vi.fn() }));

type MockPrisma = {
  client: { findUnique: ReturnType<typeof vi.fn> };
  socialAccount: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  socialAccountCredential: { findUnique: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

vi.mock("@/lib/prisma", () => {
  const socialAccount = { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() };
  return {
    prisma: {
      client: { findUnique: vi.fn() },
      socialAccount,
      socialAccountCredential: { findUnique: vi.fn() },
      /* The callback receives the same client, which is how the real one behaves for our purposes. */
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ socialAccount })),
    },
  };
});

import {
  checkAccountConnection,
  completeConnectionFromSelection,
  disconnectAccount,
} from "@/features/social/services/social-connection.service";
import { readAccessToken, storeSocialCredential, deleteSocialCredential } from "@/features/social/services/social-credential.service";
import { claimPendingAuthorization, clearPendingAuthorization } from "@/features/social/services/social-oauth-state.service";
import { socialProviderFor } from "@/features/social/services/social-provider-registry";
import type { SocialProvider } from "@/features/social/services/social-provider";
import { prisma } from "@/lib/prisma";

const mockedPrisma = prisma as unknown as MockPrisma;
const mockedClaim = claimPendingAuthorization as unknown as ReturnType<typeof vi.fn>;
const mockedClear = clearPendingAuthorization as unknown as ReturnType<typeof vi.fn>;
const mockedStore = storeSocialCredential as unknown as ReturnType<typeof vi.fn>;
const mockedRead = readAccessToken as unknown as ReturnType<typeof vi.fn>;
const mockedDelete = deleteSocialCredential as unknown as ReturnType<typeof vi.fn>;
const mockedProviderFor = socialProviderFor as unknown as ReturnType<typeof vi.fn>;

const COMPANY_ID = "company-1";
const OTHER_COMPANY_ID = "company-2";
const CLIENT_ID = "01a00001-0001-7001-b001-000000000001";
const ACCOUNT_ID = "01a00003-0003-7003-b003-000000000003";
const PAGE_ID = "10001";
const PAGE_TOKEN = "page-token-value";

const DISCOVERED = [{ externalId: PAGE_ID, name: "Catawba Yaupon", handle: null }];

/*
 * The stubbed methods are annotated with the provider interface's OWN result
 * unions, so a test can make one fail without fighting an inferred
 * success-only type — and so a change to the interface breaks these tests
 * rather than silently passing.
 */
type ListResult = Awaited<ReturnType<SocialProvider["listManageableAccounts"]>>;
type ResolveResult = Awaited<ReturnType<SocialProvider["resolveAccountCredential"]>>;

function provider(over: Record<string, unknown> = {}) {
  return {
    platform: "FACEBOOK",
    scopes: ["pages_show_list"],
    describeConfiguration: vi.fn(() => ({ configured: true })),
    buildAuthorizationUrl: vi.fn(() => "https://www.facebook.com/v25.0/dialog/oauth"),
    exchangeAuthorizationCode: vi.fn(),
    listManageableAccounts: vi.fn(async (): Promise<ListResult> => ({ ok: true, accounts: DISCOVERED })),
    resolveAccountCredential: vi.fn(
      async (): Promise<ResolveResult> => ({
        ok: true,
        authorization: { accessToken: PAGE_TOKEN, expiresAt: null, grantedScopes: ["pages_show_list"] },
      })
    ),
    ...over,
  };
}

let currentProvider: ReturnType<typeof provider>;

beforeEach(() => {
  vi.clearAllMocks();
  currentProvider = provider();
  mockedProviderFor.mockReturnValue(currentProvider);

  mockedClaim.mockResolvedValue({
    ok: true,
    context: { companyId: COMPANY_ID, clientId: CLIENT_ID, platform: "FACEBOOK", socialAccountId: null, startedByUserId: "user-1" },
    pending: {
      authorization: { accessToken: "user-token", expiresAt: null, grantedScopes: ["pages_show_list"] },
      discovered: DISCOVERED,
    },
  });

  mockedPrisma.client.findUnique.mockResolvedValue({ id: CLIENT_ID, companyId: COMPANY_ID });
  mockedPrisma.socialAccount.findFirst.mockResolvedValue(null);
  mockedPrisma.socialAccount.create.mockResolvedValue({ id: ACCOUNT_ID });
  mockedPrisma.socialAccount.update.mockResolvedValue({ id: ACCOUNT_ID });
  mockedPrisma.socialAccount.findUnique.mockResolvedValue({
    id: ACCOUNT_ID,
    companyId: COMPANY_ID,
    clientId: CLIENT_ID,
    platform: "FACEBOOK",
    externalId: PAGE_ID,
    connectionState: "CONNECTED",
    deletedAt: null,
  });
  mockedPrisma.socialAccountCredential.findUnique.mockResolvedValue({ expiresAt: null });
  mockedRead.mockResolvedValue(PAGE_TOKEN);
});

const selection = { selectionToken: "a-selection-token", externalId: PAGE_ID, actorCompanyId: COMPANY_ID, actorId: "user-1" };

describe("nothing becomes CONNECTED without a provider confirming it", () => {
  it("1. a valid selection connects, and CONNECTED is written with a connectedAt", async () => {
    const result = await completeConnectionFromSelection(selection);
    expect(result.ok).toBe(true);

    const [{ data }] = mockedPrisma.socialAccount.create.mock.calls[0];
    expect(data.connectionState).toBe("CONNECTED");
    expect(data.connectedAt).toBeInstanceOf(Date);
    expect(data.externalId).toBe(PAGE_ID);
  });

  it("2. the provider is asked to confirm the chosen page BEFORE anything is written", async () => {
    await completeConnectionFromSelection(selection);
    expect(currentProvider.resolveAccountCredential).toHaveBeenCalledWith({ accessToken: "user-token", externalId: PAGE_ID });

    const confirmOrder = currentProvider.resolveAccountCredential.mock.invocationCallOrder[0];
    const writeOrder = mockedPrisma.socialAccount.create.mock.invocationCallOrder[0];
    expect(confirmOrder).toBeLessThan(writeOrder);
  });

  it("3. a page the provider REFUSES is not connected, and nothing is written", async () => {
    currentProvider.resolveAccountCredential.mockResolvedValue({
      ok: false,
      failure: { message: "That Page is not one this Facebook account manages." },
    });

    const result = await completeConnectionFromSelection(selection);
    expect(result.ok).toBe(false);
    expect(mockedPrisma.socialAccount.create).not.toHaveBeenCalled();
    expect(mockedPrisma.socialAccount.update).not.toHaveBeenCalled();
    expect(mockedStore).not.toHaveBeenCalled();
    /* And the parked authorization is destroyed rather than left for a retry. */
    expect(mockedClear).toHaveBeenCalled();
  });

  it("4. an invalid or reused selection connects nothing", async () => {
    mockedClaim.mockResolvedValue({ ok: false, reason: "ALREADY_USED" });
    const result = await completeConnectionFromSelection(selection);
    expect(result.ok).toBe(false);
    expect(currentProvider.resolveAccountCredential).not.toHaveBeenCalled();
    expect(mockedPrisma.socialAccount.create).not.toHaveBeenCalled();
  });

  it("5. a selection redeemed by ANOTHER COMPANY connects nothing and burns the authorization", async () => {
    const result = await completeConnectionFromSelection({ ...selection, actorCompanyId: OTHER_COMPANY_ID });
    expect(result.ok).toBe(false);
    expect(currentProvider.resolveAccountCredential).not.toHaveBeenCalled();
    expect(mockedPrisma.socialAccount.create).not.toHaveBeenCalled();
    expect(mockedClear).toHaveBeenCalled();
  });

  it("6. a client that is not the actor's own connects nothing", async () => {
    mockedPrisma.client.findUnique.mockResolvedValue({ id: CLIENT_ID, companyId: OTHER_COMPANY_ID });
    const result = await completeConnectionFromSelection(selection);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toBe("Client not found.");
    expect(mockedPrisma.socialAccount.create).not.toHaveBeenCalled();
  });

  it("7. a platform with no provider connects nothing", async () => {
    mockedProviderFor.mockReturnValue(null);
    const result = await completeConnectionFromSelection(selection);
    expect(result.ok).toBe(false);
    expect(mockedPrisma.socialAccount.create).not.toHaveBeenCalled();
  });

  it("8. the account is created under the ACTOR'S company, never one from the claim", async () => {
    await completeConnectionFromSelection(selection);
    const [{ data }] = mockedPrisma.socialAccount.create.mock.calls[0];
    expect(data.companyId).toBe(COMPANY_ID);
    expect(data.clientId).toBe(CLIENT_ID);
  });
});

describe("an existing hand-configured account is reattached, not duplicated", () => {
  it("9. a client's identity-only account on the same platform becomes the connected one", async () => {
    /*
     * This is the "Catawba Yaupon, added by hand" case: the row keeps its id,
     * so every post already targeting it stays attached.
     */
    mockedPrisma.socialAccount.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
      where.externalId === null ? { id: ACCOUNT_ID, clientId: CLIENT_ID } : null
    );

    const result = await completeConnectionFromSelection(selection);
    expect(result.ok).toBe(true);
    expect(mockedPrisma.socialAccount.create).not.toHaveBeenCalled();

    const [{ where, data }] = mockedPrisma.socialAccount.update.mock.calls[0];
    expect(where).toEqual({ id: ACCOUNT_ID });
    expect(data.connectionState).toBe("CONNECTED");
    expect(data.externalId).toBe(PAGE_ID);
  });

  it("10. reconnecting reuses the account the flow was started for", async () => {
    mockedClaim.mockResolvedValue({
      ok: true,
      context: {
        companyId: COMPANY_ID,
        clientId: CLIENT_ID,
        platform: "FACEBOOK",
        socialAccountId: ACCOUNT_ID,
        startedByUserId: "user-1",
      },
      pending: {
        authorization: { accessToken: "user-token", expiresAt: null, grantedScopes: [] },
        discovered: DISCOVERED,
      },
    });
    mockedPrisma.socialAccount.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
      where.id === ACCOUNT_ID ? { id: ACCOUNT_ID, clientId: CLIENT_ID } : null
    );

    await completeConnectionFromSelection(selection);
    expect(mockedPrisma.socialAccount.create).not.toHaveBeenCalled();
    expect(mockedPrisma.socialAccount.update.mock.calls[0][0].where).toEqual({ id: ACCOUNT_ID });
  });

  it("11. reconnecting clears a previous failure and disconnection", async () => {
    mockedPrisma.socialAccount.findFirst.mockResolvedValue({ id: ACCOUNT_ID, clientId: CLIENT_ID });
    await completeConnectionFromSelection(selection);
    const [{ data }] = mockedPrisma.socialAccount.update.mock.calls[0];
    expect(data.lastCheckError).toBeNull();
    expect(data.disconnectedAt).toBeNull();
    expect(data.deletedAt).toBeNull();
  });

  it("12. the display name comes from the provider, never invented", async () => {
    await completeConnectionFromSelection(selection);
    const [{ data }] = mockedPrisma.socialAccount.create.mock.calls[0];
    expect(data.displayName).toBe("Catawba Yaupon");
  });

  it("13. REVIEW FINDING — a Page already connected to ANOTHER CLIENT in the same company must not be silently reattached", async () => {
    /*
     * The unique constraint is @@unique([companyId, platform, externalId]) —
     * scoped to the COMPANY, not the client. So the priority-2 lookup
     * (companyId + platform + externalId) can find a row that belongs to a
     * DIFFERENT client than the one this flow was started for. Reconnecting
     * that row without reassigning clientId would silently refresh Client
     * A's credential while the caller believes (and the response would have
     * claimed) it connected the Page to Client B.
     */
    const OTHER_CLIENT_ID = "01a00099-0099-7099-b099-000000000099";
    mockedPrisma.socialAccount.findFirst.mockImplementation(async ({ where }) => {
      // Priority 1 (context.socialAccountId) — not set for this flow, skip.
      if ("id" in where) return null;
      // Priority 2 — the cross-client match: same company+platform+externalId, but a DIFFERENT client owns it.
      if (where.externalId === PAGE_ID) return { id: ACCOUNT_ID, clientId: OTHER_CLIENT_ID };
      return null;
    });

    const result = await completeConnectionFromSelection(selection);

    // Must be refused, not silently connected under the wrong pretense.
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(/already.*connected to another client/i);

    // Nothing about the OTHER client's row may be modified by this flow.
    expect(mockedPrisma.socialAccount.update).not.toHaveBeenCalled();
    expect(mockedPrisma.socialAccount.create).not.toHaveBeenCalled();
    expect(mockedStore).not.toHaveBeenCalled();
  });

  it("14. Phase 9E — a SECOND, DIFFERENT Page for a client that already has one connected account creates a NEW row", async () => {
    /*
     * The spec: "Client A: Facebook Page 1, Facebook Page 2, Instagram
     * Account 1". Priority 2 (companyId + platform + externalId) only ever
     * matches the EXACT same real Page — a different externalId matches
     * nothing there, and priority 3 only reattaches to an identity-only
     * account (externalId: null), never to one that is already connected to
     * a different real Page. So a second, distinct Page must fall through to
     * create(), not silently reuse or collide with the first.
     */
    const SECOND_PAGE_ID = "10002";
    mockedPrisma.socialAccount.findFirst.mockImplementation(async ({ where }) => {
      if ("id" in where) return null;
      // Priority 2 — no existing row carries THIS externalId yet.
      if ("externalId" in where && where.externalId === SECOND_PAGE_ID) return null;
      // Priority 3 — the client's existing Facebook account is already connected (externalId set), so it must not match here.
      if ("deletedAt" in where) return null;
      return null;
    });

    const result = await completeConnectionFromSelection({ ...selection, externalId: SECOND_PAGE_ID });

    expect(result.ok).toBe(true);
    expect(mockedPrisma.socialAccount.update).not.toHaveBeenCalled();
    const [{ data }] = mockedPrisma.socialAccount.create.mock.calls[0];
    expect(data.externalId).toBe(SECOND_PAGE_ID);
    expect(data.clientId).toBe(CLIENT_ID);
  });
});

describe("the credential is stored, and only the credential", () => {
  it("13. the PAGE token is stored under the actor's company", async () => {
    await completeConnectionFromSelection(selection);
    expect(mockedStore).toHaveBeenCalledWith({
      socialAccountId: ACCOUNT_ID,
      companyId: COMPANY_ID,
      accessToken: PAGE_TOKEN,
      expiresAt: null,
      grantedScopes: ["pages_show_list"],
    });
  });

  it("14. no token is ever part of what this function returns", async () => {
    const result = await completeConnectionFromSelection(selection);
    expect(JSON.stringify(result)).not.toContain(PAGE_TOKEN);
    expect(JSON.stringify(result)).not.toContain("user-token");
  });

  it("15. if the credential cannot be stored, the account is NEEDS_RECONNECT — never left CONNECTED", async () => {
    mockedStore.mockRejectedValue(new Error("disk on fire"));
    const result = await completeConnectionFromSelection(selection);
    expect(result.ok).toBe(false);

    const repair = mockedPrisma.socialAccount.update.mock.calls.at(-1)![0];
    expect(repair.data.connectionState).toBe("NEEDS_RECONNECT");
    expect(repair.data.lastCheckError).toMatch(/could not be stored securely/i);
    /* And the message a person sees names no secret. */
    expect(!result.ok && result.message).not.toContain(PAGE_TOKEN);
  });

  it("16. the parked authorization is always cleared once the flow ends", async () => {
    await completeConnectionFromSelection(selection);
    expect(mockedClear).toHaveBeenCalledWith("selection-hash");
  });
});

describe("disconnecting", () => {
  it("17. destroys the credential and keeps the account", async () => {
    const result = await disconnectAccount({ socialAccountId: ACCOUNT_ID, actorCompanyId: COMPANY_ID });
    expect(result.ok).toBe(true);
    expect(mockedDelete).toHaveBeenCalledWith(ACCOUNT_ID, COMPANY_ID);

    const [{ data }] = mockedPrisma.socialAccount.update.mock.calls[0];
    expect(data.connectionState).toBe("DISCONNECTED");
    expect(data.disconnectedAt).toBeInstanceOf(Date);
    expect(data.connectedAt).toBeNull();
    /* The identity row is NOT deleted — saved posts point at it. */
    expect(data.deletedAt).toBeUndefined();
  });

  it("18. does not touch the user's own enable/disable switch", async () => {
    await disconnectAccount({ socialAccountId: ACCOUNT_ID, actorCompanyId: COMPANY_ID });
    const [{ data }] = mockedPrisma.socialAccount.update.mock.calls[0];
    expect(data.status).toBeUndefined();
  });

  it("19. keeps externalId, so a reconnect lands on the same row", async () => {
    await disconnectAccount({ socialAccountId: ACCOUNT_ID, actorCompanyId: COMPANY_ID });
    const [{ data }] = mockedPrisma.socialAccount.update.mock.calls[0];
    expect(data.externalId).toBeUndefined();
  });

  it("20. another company's account cannot be disconnected", async () => {
    mockedPrisma.socialAccount.findUnique.mockResolvedValue({
      id: ACCOUNT_ID,
      companyId: OTHER_COMPANY_ID,
      clientId: CLIENT_ID,
      deletedAt: null,
    });
    const result = await disconnectAccount({ socialAccountId: ACCOUNT_ID, actorCompanyId: COMPANY_ID });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toBe("Social account not found.");
    expect(mockedDelete).not.toHaveBeenCalled();
    expect(mockedPrisma.socialAccount.update).not.toHaveBeenCalled();
  });

  it("21. a soft-deleted account is not reachable", async () => {
    mockedPrisma.socialAccount.findUnique.mockResolvedValue({
      id: ACCOUNT_ID,
      companyId: COMPANY_ID,
      clientId: CLIENT_ID,
      deletedAt: new Date(),
    });
    const result = await disconnectAccount({ socialAccountId: ACCOUNT_ID, actorCompanyId: COMPANY_ID });
    expect(result.ok).toBe(false);
  });
});

describe("checking a connection is what produces NEEDS_RECONNECT", () => {
  it("22. a provider that still confirms the page leaves it CONNECTED", async () => {
    const result = await checkAccountConnection({ socialAccountId: ACCOUNT_ID, actorCompanyId: COMPANY_ID });
    expect(result.ok && result.data.connectionState).toBe("CONNECTED");
    const [{ data }] = mockedPrisma.socialAccount.update.mock.calls[0];
    expect(data.lastCheckedAt).toBeInstanceOf(Date);
    expect(data.lastCheckError).toBeNull();
  });

  it("23. an EXPIRED credential means NEEDS_RECONNECT, from the provider's stated expiry", async () => {
    mockedPrisma.socialAccountCredential.findUnique.mockResolvedValue({ expiresAt: new Date(Date.now() - 1000) });
    const result = await checkAccountConnection({ socialAccountId: ACCOUNT_ID, actorCompanyId: COMPANY_ID });
    expect(result.ok && result.data.connectionState).toBe("NEEDS_RECONNECT");
    expect(mockedPrisma.socialAccount.update.mock.calls[0][0].data.lastCheckError).toMatch(/expired/i);
  });

  it("24. a missing credential means NEEDS_RECONNECT", async () => {
    mockedPrisma.socialAccountCredential.findUnique.mockResolvedValue(null);
    const result = await checkAccountConnection({ socialAccountId: ACCOUNT_ID, actorCompanyId: COMPANY_ID });
    expect(result.ok && result.data.connectionState).toBe("NEEDS_RECONNECT");
  });

  it("25. a provider that rejects the authorization means NEEDS_RECONNECT", async () => {
    currentProvider.listManageableAccounts.mockResolvedValue({
      ok: false,
      failure: { message: "Facebook could not list the Pages for this account." },
    });
    const result = await checkAccountConnection({ socialAccountId: ACCOUNT_ID, actorCompanyId: COMPANY_ID });
    expect(result.ok && result.data.connectionState).toBe("NEEDS_RECONNECT");
  });

  it("26. losing access to the page means NEEDS_RECONNECT", async () => {
    currentProvider.listManageableAccounts.mockResolvedValue({
      ok: true,
      accounts: [{ externalId: "a-different-page", name: "Something Else", handle: null }],
    });
    const result = await checkAccountConnection({ socialAccountId: ACCOUNT_ID, actorCompanyId: COMPANY_ID });
    expect(result.ok && result.data.connectionState).toBe("NEEDS_RECONNECT");
    expect(mockedPrisma.socialAccount.update.mock.calls[0][0].data.lastCheckError).toMatch(/no longer has access/i);
  });

  it("27. lastCheckError never contains a credential", async () => {
    currentProvider.listManageableAccounts.mockResolvedValue({
      ok: false,
      failure: { message: "Facebook could not list the Pages for this account.", logDetail: `token=${PAGE_TOKEN}` },
    });
    await checkAccountConnection({ socialAccountId: ACCOUNT_ID, actorCompanyId: COMPANY_ID });
    const [{ data }] = mockedPrisma.socialAccount.update.mock.calls[0];
    expect(data.lastCheckError).not.toContain(PAGE_TOKEN);
  });

  it("28. a NOT_CONNECTED account has nothing to check, and is not silently 'checked'", async () => {
    mockedPrisma.socialAccount.findUnique.mockResolvedValue({
      id: ACCOUNT_ID,
      companyId: COMPANY_ID,
      platform: "FACEBOOK",
      externalId: null,
      connectionState: "NOT_CONNECTED",
    });
    const result = await checkAccountConnection({ socialAccountId: ACCOUNT_ID, actorCompanyId: COMPANY_ID });
    expect(result.ok).toBe(false);
    expect(mockedPrisma.socialAccount.update).not.toHaveBeenCalled();
  });

  it("29. another company's account cannot be checked", async () => {
    mockedPrisma.socialAccount.findUnique.mockResolvedValue({
      id: ACCOUNT_ID,
      companyId: OTHER_COMPANY_ID,
      platform: "FACEBOOK",
      externalId: PAGE_ID,
      connectionState: "CONNECTED",
    });
    const result = await checkAccountConnection({ socialAccountId: ACCOUNT_ID, actorCompanyId: COMPANY_ID });
    expect(result.ok).toBe(false);
    expect(mockedRead).not.toHaveBeenCalled();
  });

  it("30. the credential is read under the actor's company", async () => {
    await checkAccountConnection({ socialAccountId: ACCOUNT_ID, actorCompanyId: COMPANY_ID });
    expect(mockedRead).toHaveBeenCalledWith(ACCOUNT_ID, COMPANY_ID);
  });
});
