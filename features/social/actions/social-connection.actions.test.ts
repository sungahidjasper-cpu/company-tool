import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 9 — who may connect what.
 *
 * The subject is authorization, so every test here is about an id arriving
 * from a browser and NOT being trusted: another company's client, another
 * company's account, a client from a different company than the account, and
 * a role that may not manage clients at all.
 *
 * The provider is stubbed to be configured so that a refusal can only ever be
 * an authorization refusal, never "Facebook is not set up".
 */
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

vi.mock("@/features/social/services/social-connection.service", () => ({
  completeConnectionFromSelection: vi.fn(),
  disconnectAccount: vi.fn(),
  checkAccountConnection: vi.fn(),
}));
vi.mock("@/features/social/services/social-oauth-state.service", () => ({
  createOAuthState: vi.fn(),
  discardUnfinishedFlows: vi.fn(),
}));

type MockPrisma = {
  client: { findUnique: ReturnType<typeof vi.fn> };
  socialAccount: { findFirst: ReturnType<typeof vi.fn> };
};

vi.mock("@/lib/prisma", () => ({
  prisma: { client: { findUnique: vi.fn() }, socialAccount: { findFirst: vi.fn() } },
}));

import {
  checkSocialConnectionAction,
  disconnectSocialAccountAction,
  listPlatformConnectivityAction,
  selectDiscoveredAccountAction,
  startSocialConnectionAction,
} from "@/features/social/actions/social-connection.actions";
import {
  checkAccountConnection,
  completeConnectionFromSelection,
  disconnectAccount,
} from "@/features/social/services/social-connection.service";
import { createOAuthState, discardUnfinishedFlows } from "@/features/social/services/social-oauth-state.service";
import { logActivity } from "@/lib/activity";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";

const mockedPrisma = prisma as unknown as MockPrisma;
const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedCookies = cookies as unknown as ReturnType<typeof vi.fn>;
const mockedLogActivity = logActivity as unknown as ReturnType<typeof vi.fn>;
const mockedCreateState = createOAuthState as unknown as ReturnType<typeof vi.fn>;
const mockedDiscard = discardUnfinishedFlows as unknown as ReturnType<typeof vi.fn>;
const mockedComplete = completeConnectionFromSelection as unknown as ReturnType<typeof vi.fn>;
const mockedDisconnect = disconnectAccount as unknown as ReturnType<typeof vi.fn>;
const mockedCheck = checkAccountConnection as unknown as ReturnType<typeof vi.fn>;

const CLIENT_ID = "01a00001-0001-7001-b001-000000000001";
const OTHER_COMPANY_CLIENT_ID = "01a00002-0002-7002-b002-000000000002";
const ACCOUNT_ID = "01a00003-0003-7003-b003-000000000003";

const MANAGER = { id: "user-1", companyId: "company-1", role: "MANAGER" };
const EMPLOYEE = { id: "user-2", companyId: "company-1", role: "EMPLOYEE" };

const APP_ID = "test-app-id-not-real";
const APP_SECRET = "test-app-secret-not-real";

function cookieStore(value: string | null) {
  return {
    get: vi.fn(() => (value === null ? undefined : { name: "cc_social_connect", value })),
    delete: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  /* Configured, so any refusal below is about authorization and nothing else. */
  process.env.FACEBOOK_APP_ID = APP_ID;
  process.env.FACEBOOK_APP_SECRET = APP_SECRET;
  process.env.NEXTAUTH_URL = "https://example.test";

  mockedRequireUser.mockResolvedValue(MANAGER);
  mockedPrisma.client.findUnique.mockResolvedValue({
    id: CLIENT_ID,
    companyId: "company-1",
    name: "Catawba Yaupon",
    deletedAt: null,
  });
  mockedPrisma.socialAccount.findFirst.mockResolvedValue({ id: ACCOUNT_ID });
  mockedCreateState.mockResolvedValue("a-state-value-long-enough-to-be-real");
  mockedDiscard.mockResolvedValue(0);
  mockedComplete.mockResolvedValue({ ok: true, data: { socialAccountId: ACCOUNT_ID, clientId: CLIENT_ID, displayName: "Catawba Yaupon" } });
  mockedDisconnect.mockResolvedValue({ ok: true, data: { socialAccountId: ACCOUNT_ID, clientId: CLIENT_ID } });
  mockedCheck.mockResolvedValue({ ok: true, data: { connectionState: "CONNECTED" } });
  mockedCookies.mockResolvedValue(cookieStore("a-selection-token-long-enough"));
});

describe("only a manager may connect a client's social accounts", () => {
  it("1. an employee is refused on every connection action, and nothing is started", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);

    const results = [
      await startSocialConnectionAction({ clientId: CLIENT_ID, platform: "FACEBOOK" }),
      await selectDiscoveredAccountAction({ externalId: "10001" }),
      await disconnectSocialAccountAction({ accountId: ACCOUNT_ID }),
      await checkSocialConnectionAction(ACCOUNT_ID),
    ];

    for (const result of results) {
      expect(result.success).toBe(false);
      expect(!result.success && result.message).toMatch(/do not have permission/i);
    }
    expect(mockedCreateState).not.toHaveBeenCalled();
    expect(mockedComplete).not.toHaveBeenCalled();
    expect(mockedDisconnect).not.toHaveBeenCalled();
  });
});

describe("a client id from the browser is a claim, not a fact", () => {
  it("2. another company's client cannot be connected, and reads as not found", async () => {
    mockedPrisma.client.findUnique.mockResolvedValue({
      id: OTHER_COMPANY_CLIENT_ID,
      companyId: "company-2",
      name: "Someone Else",
      deletedAt: null,
    });

    const result = await startSocialConnectionAction({ clientId: OTHER_COMPANY_CLIENT_ID, platform: "FACEBOOK" });
    expect(result.success).toBe(false);
    /* Indistinguishable from a client that does not exist. */
    expect(!result.success && result.message).toBe("Client not found.");
    expect(mockedCreateState).not.toHaveBeenCalled();
  });

  it("3. a malformed client id is refused before any query runs", async () => {
    const result = await startSocialConnectionAction({ clientId: "not-a-uuid", platform: "FACEBOOK" });
    expect(result.success).toBe(false);
    expect(mockedPrisma.client.findUnique).not.toHaveBeenCalled();
  });

  it("4. a trashed client cannot be connected", async () => {
    mockedPrisma.client.findUnique.mockResolvedValue({
      id: CLIENT_ID,
      companyId: "company-1",
      name: "Catawba Yaupon",
      deletedAt: new Date(),
    });
    const result = await startSocialConnectionAction({ clientId: CLIENT_ID, platform: "FACEBOOK" });
    expect(result.success).toBe(false);
    expect(!result.success && result.message).toMatch(/in the trash/i);
    expect(mockedCreateState).not.toHaveBeenCalled();
  });

  it("5. the state is created for the ACTOR'S company, never one supplied by the caller", async () => {
    await startSocialConnectionAction({
      clientId: CLIENT_ID,
      platform: "FACEBOOK",
      ...({ companyId: "company-2" } as object),
    });
    expect(mockedCreateState).toHaveBeenCalledWith(expect.objectContaining({ companyId: "company-1", clientId: CLIENT_ID }));
  });
});

describe("reconnecting one specific account", () => {
  it("6. an account belonging to another company is refused", async () => {
    /* The lookup is scoped by company and client, so a foreign id resolves to nothing. */
    mockedPrisma.socialAccount.findFirst.mockResolvedValue(null);
    const result = await startSocialConnectionAction({ clientId: CLIENT_ID, platform: "FACEBOOK", accountId: ACCOUNT_ID });
    expect(result.success).toBe(false);
    expect(!result.success && result.message).toBe("Social account not found.");
    expect(mockedCreateState).not.toHaveBeenCalled();
  });

  it("7. the account is looked up under the actor's company, client AND platform", async () => {
    await startSocialConnectionAction({ clientId: CLIENT_ID, platform: "FACEBOOK", accountId: ACCOUNT_ID });
    expect(mockedPrisma.socialAccount.findFirst).toHaveBeenCalledWith({
      where: { id: ACCOUNT_ID, companyId: "company-1", clientId: CLIENT_ID, platform: "FACEBOOK", deletedAt: null },
      select: { id: true },
    });
  });

  it("8. a cross-client reconnect is refused — Client A's account under Client B", async () => {
    /*
     * The where clause above includes clientId, so an account belonging to a
     * DIFFERENT client of the SAME company does not resolve either. Isolation
     * is per-client, not just per-company.
     */
    mockedPrisma.socialAccount.findFirst.mockResolvedValue(null);
    const result = await startSocialConnectionAction({
      clientId: CLIENT_ID,
      platform: "FACEBOOK",
      accountId: ACCOUNT_ID,
    });
    expect(result.success).toBe(false);
    expect(mockedCreateState).not.toHaveBeenCalled();
  });
});

describe("Phase 9B — a new flow never resumes an old one", () => {
  it("R1. starting a flow discards this client's unfinished attempts first", async () => {
    await startSocialConnectionAction({ clientId: CLIENT_ID, platform: "FACEBOOK" });
    expect(mockedDiscard).toHaveBeenCalledWith({
      companyId: "company-1",
      clientId: CLIENT_ID,
      platform: "FACEBOOK",
    });
  });

  it("R2. the discard happens BEFORE the new state is created", async () => {
    await startSocialConnectionAction({ clientId: CLIENT_ID, platform: "FACEBOOK" });
    expect(mockedDiscard.mock.invocationCallOrder[0]).toBeLessThan(mockedCreateState.mock.invocationCallOrder[0]);
  });

  it("R3. a reconnect discards too, and still creates a brand-new state", async () => {
    await startSocialConnectionAction({ clientId: CLIENT_ID, platform: "FACEBOOK", accountId: ACCOUNT_ID });
    expect(mockedDiscard).toHaveBeenCalledTimes(1);
    expect(mockedCreateState).toHaveBeenCalledTimes(1);
    /* And it is tied to the account being reconnected. */
    expect(mockedCreateState).toHaveBeenCalledWith(expect.objectContaining({ socialAccountId: ACCOUNT_ID }));
  });

  it("R4. a reconnect is scoped to this company and client, so it cannot be aimed elsewhere", async () => {
    await startSocialConnectionAction({ clientId: CLIENT_ID, platform: "FACEBOOK", accountId: ACCOUNT_ID });
    expect(mockedDiscard).toHaveBeenCalledWith(expect.objectContaining({ companyId: "company-1", clientId: CLIENT_ID }));
  });

  it("R5. nothing is discarded when the flow is refused before it starts", async () => {
    /* An unconfigured platform must not have side effects on existing flows. */
    delete process.env.FACEBOOK_APP_ID;
    delete process.env.FACEBOOK_APP_SECRET;
    const result = await startSocialConnectionAction({ clientId: CLIENT_ID, platform: "FACEBOOK" });
    expect(result.success).toBe(false);
    expect(mockedDiscard).not.toHaveBeenCalled();
    expect(mockedCreateState).not.toHaveBeenCalled();
  });

  it("R6. a reconnect is recorded distinctly from a first connection", async () => {
    await startSocialConnectionAction({ clientId: CLIENT_ID, platform: "FACEBOOK", accountId: ACCOUNT_ID });
    expect(mockedLogActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "client.social_reconnection_started" })
    );

    mockedLogActivity.mockClear();
    await startSocialConnectionAction({ clientId: CLIENT_ID, platform: "FACEBOOK" });
    expect(mockedLogActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "client.social_connection_started" })
    );
  });

  it("R7. no activity log entry carries a state value or a token", async () => {
    await startSocialConnectionAction({ clientId: CLIENT_ID, platform: "FACEBOOK" });
    const logged = JSON.stringify(mockedLogActivity.mock.calls);
    expect(logged).not.toContain("a-state-value-long-enough-to-be-real");
    expect(logged).not.toMatch(/accessToken|access_token|client_secret/i);
  });
});

describe("what the browser gets back", () => {
  it("9. starting a flow returns a URL and no secret", async () => {
    const result = await startSocialConnectionAction({ clientId: CLIENT_ID, platform: "FACEBOOK" });
    expect(result.success).toBe(true);
    const payload = JSON.stringify(result);
    expect(payload).not.toContain(APP_SECRET);
    expect(payload).toContain("facebook.com");
  });

  it("10. no connection action ever returns a token-shaped field", async () => {
    const results = [
      await startSocialConnectionAction({ clientId: CLIENT_ID, platform: "FACEBOOK" }),
      await selectDiscoveredAccountAction({ externalId: "10001" }),
      await disconnectSocialAccountAction({ accountId: ACCOUNT_ID }),
      await checkSocialConnectionAction(ACCOUNT_ID),
    ];
    for (const result of results) {
      expect(JSON.stringify(result)).not.toMatch(/accessToken|access_token|encryptedPayload|client_secret/i);
    }
  });
});

describe("finishing a connection", () => {
  it("11. the selection token comes from the cookie, and the actor's own company is passed down", async () => {
    await selectDiscoveredAccountAction({ externalId: "10001" });
    expect(mockedComplete).toHaveBeenCalledWith({
      selectionToken: "a-selection-token-long-enough",
      externalId: "10001",
      actorCompanyId: "company-1",
      actorId: "user-1",
    });
  });

  it("12. with no cookie there is nothing to finish, and the service is never called", async () => {
    mockedCookies.mockResolvedValue(cookieStore(null));
    const result = await selectDiscoveredAccountAction({ externalId: "10001" });
    expect(result.success).toBe(false);
    expect(mockedComplete).not.toHaveBeenCalled();
  });

  it("13. a selectionToken sent in the body is ignored — the cookie decides", async () => {
    await selectDiscoveredAccountAction({
      externalId: "10001",
      ...({ selectionToken: "attacker-supplied-token-value" } as object),
    });
    expect(mockedComplete).toHaveBeenCalledWith(expect.objectContaining({ selectionToken: "a-selection-token-long-enough" }));
  });

  it("14. the cookie is cleared whether the connection succeeded or failed", async () => {
    const store = cookieStore("a-selection-token-long-enough");
    mockedCookies.mockResolvedValue(store);
    await selectDiscoveredAccountAction({ externalId: "10001" });
    expect(store.delete).toHaveBeenCalledWith("cc_social_connect");

    store.delete.mockClear();
    mockedComplete.mockResolvedValue({ ok: false, message: "nope" });
    await selectDiscoveredAccountAction({ externalId: "10001" });
    expect(store.delete).toHaveBeenCalledWith("cc_social_connect");
  });

  it("15. an empty page id is refused by validation", async () => {
    const result = await selectDiscoveredAccountAction({ externalId: "" });
    expect(result.success).toBe(false);
    expect(mockedComplete).not.toHaveBeenCalled();
  });
});

describe("disconnecting and checking", () => {
  it("16. disconnect passes the actor's company, so another company's account is unreachable", async () => {
    await disconnectSocialAccountAction({ accountId: ACCOUNT_ID });
    expect(mockedDisconnect).toHaveBeenCalledWith({ socialAccountId: ACCOUNT_ID, actorCompanyId: "company-1" });
  });

  it("17. a malformed account id never reaches the service", async () => {
    const result = await disconnectSocialAccountAction({ accountId: "nonsense" });
    expect(result.success).toBe(false);
    expect(mockedDisconnect).not.toHaveBeenCalled();
  });

  it("18. checking resolves the account through the actor's company first", async () => {
    await checkSocialConnectionAction(ACCOUNT_ID);
    expect(mockedPrisma.socialAccount.findFirst).toHaveBeenCalledWith({
      where: { id: ACCOUNT_ID, companyId: "company-1" },
      select: { clientId: true },
    });
  });

  it("19. checking another company's account reads as not found", async () => {
    mockedPrisma.socialAccount.findFirst.mockResolvedValue(null);
    const result = await checkSocialConnectionAction(ACCOUNT_ID);
    expect(result.success).toBe(false);
    expect(!result.success && result.message).toBe("Social account not found.");
    expect(mockedCheck).not.toHaveBeenCalled();
  });
});

describe("what the settings screen is told about configuration", () => {
  it("20. an unconfigured platform is reported honestly, with a plain sentence", async () => {
    delete process.env.FACEBOOK_APP_ID;
    delete process.env.FACEBOOK_APP_SECRET;

    const result = await listPlatformConnectivityAction();
    expect(result.success).toBe(true);
    const facebook = result.success ? result.data.find((row) => row.platform === "FACEBOOK") : undefined;
    expect(facebook).toMatchObject({ connectable: true, configured: false });
    expect(facebook?.summary).toBe("Facebook connection is not configured yet.");
  });

  it("21. a manager may see WHICH variables are unset — names only, never values", async () => {
    delete process.env.FACEBOOK_APP_ID;
    delete process.env.FACEBOOK_APP_SECRET;

    const result = await listPlatformConnectivityAction();
    const facebook = result.success ? result.data.find((row) => row.platform === "FACEBOOK") : undefined;
    expect(facebook?.missingKeys).toEqual(["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"]);
    expect(JSON.stringify(result)).not.toContain(APP_SECRET);
  });

  it("22. a non-manager is told nothing about this server's configuration", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    delete process.env.FACEBOOK_APP_ID;
    delete process.env.FACEBOOK_APP_SECRET;

    const result = await listPlatformConnectivityAction();
    const facebook = result.success ? result.data.find((row) => row.platform === "FACEBOOK") : undefined;
    expect(facebook?.missingKeys).toEqual([]);
    /* The plain sentence still reaches them, because it tells them what to expect. */
    expect(facebook?.summary).toBe("Facebook connection is not configured yet.");
  });

  it("23. a platform with no provider is described as unavailable, not as unconfigured", async () => {
    const result = await listPlatformConnectivityAction();
    const instagram = result.success ? result.data.find((row) => row.platform === "INSTAGRAM") : undefined;
    expect(instagram).toMatchObject({ connectable: false, configured: false });
    expect(instagram?.summary).toMatch(/not available yet/i);
  });

  it("24. exactly one platform can be connected today, and it is Facebook", async () => {
    const result = await listPlatformConnectivityAction();
    const connectable = result.success ? result.data.filter((row) => row.connectable).map((row) => row.platform) : [];
    expect(connectable).toEqual(["FACEBOOK"]);
  });

  it("25. starting a flow for a platform with no provider is refused", async () => {
    const result = await startSocialConnectionAction({ clientId: CLIENT_ID, platform: "INSTAGRAM" });
    expect(result.success).toBe(false);
    expect(!result.success && result.message).toMatch(/not available yet/i);
    expect(mockedCreateState).not.toHaveBeenCalled();
  });

  it("26. starting a flow with no app credentials is refused with the honest message", async () => {
    delete process.env.FACEBOOK_APP_ID;
    delete process.env.FACEBOOK_APP_SECRET;
    const result = await startSocialConnectionAction({ clientId: CLIENT_ID, platform: "FACEBOOK" });
    expect(result.success).toBe(false);
    expect(!result.success && result.message).toBe("Facebook connection is not configured yet.");
    expect(mockedCreateState).not.toHaveBeenCalled();
  });
});
