import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));

type MockPrisma = {
  client: { findUnique: ReturnType<typeof vi.fn> };
  socialAccount: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  socialPostTarget: { count: ReturnType<typeof vi.fn> };
  socialAccountCredential: { deleteMany: ReturnType<typeof vi.fn> };
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    client: { findUnique: vi.fn() },
    socialAccount: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    socialPostTarget: { count: vi.fn() },
    socialAccountCredential: { deleteMany: vi.fn() },
  },
}));

import {
  addSocialAccountAction,
  listClientSocialAccountsAction,
  removeSocialAccountAction,
  setSocialAccountStatusAction,
  updateSocialAccountAction,
} from "@/features/social/actions/social-account.actions";
import { logActivity } from "@/lib/activity";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const mockedPrisma = prisma as unknown as MockPrisma;
const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedLogActivity = logActivity as unknown as ReturnType<typeof vi.fn>;

const CLIENT_ID = "01a00001-0001-7001-b001-000000000001";
const OTHER_CLIENT_ID = "01a00002-0002-7002-b002-000000000002";
const ACCOUNT_ID = "01a00003-0003-7003-b003-000000000003";

const MANAGER = { id: "user-1", companyId: "company-1", role: "MANAGER" };
const EMPLOYEE = { id: "user-2", companyId: "company-1", role: "EMPLOYEE" };

const accountRow = (over: Record<string, unknown> = {}) => ({
  id: ACCOUNT_ID,
  clientId: CLIENT_ID,
  platform: "FACEBOOK",
  handle: "storagemoguls",
  displayName: "Storage Moguls",
  status: "ACTIVE",
  /* Phase 9 — a hand-added account, which is what NOT_CONNECTED means. */
  externalId: null,
  connectionState: "NOT_CONNECTED",
  connectedAt: null,
  lastCheckedAt: null,
  lastCheckError: null,
  _count: { targets: 0 },
  credential: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequireUser.mockResolvedValue(MANAGER);
  mockedPrisma.client.findUnique.mockResolvedValue({ id: CLIENT_ID, companyId: "company-1", name: "Storage Moguls", deletedAt: null });
  mockedPrisma.socialAccount.findUnique.mockResolvedValue({
    id: ACCOUNT_ID,
    companyId: "company-1",
    clientId: CLIENT_ID,
    platform: "FACEBOOK",
    handle: "storagemoguls",
    deletedAt: null,
  });
  mockedPrisma.socialAccount.findFirst.mockResolvedValue(null);
  mockedPrisma.socialAccount.findMany.mockResolvedValue([accountRow()]);
  mockedPrisma.socialAccount.create.mockResolvedValue(accountRow());
  mockedPrisma.socialAccount.update.mockResolvedValue(accountRow());
  mockedPrisma.socialPostTarget.count.mockResolvedValue(0);
  mockedPrisma.socialAccountCredential.deleteMany.mockResolvedValue({ count: 0 });
});

describe("only a manager may configure a client's social accounts", () => {
  it("1. an employee is refused on every action, and nothing is written", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const results = await Promise.all([
      listClientSocialAccountsAction(CLIENT_ID),
      addSocialAccountAction({ clientId: CLIENT_ID, platform: "FACEBOOK", handle: "sm" }),
      updateSocialAccountAction({ accountId: ACCOUNT_ID, handle: "sm" }),
      setSocialAccountStatusAction({ accountId: ACCOUNT_ID, status: "DISCONNECTED" }),
      removeSocialAccountAction(ACCOUNT_ID),
    ]);
    for (const result of results) expect(result.success).toBe(false);
    expect(mockedPrisma.socialAccount.create).not.toHaveBeenCalled();
    expect(mockedPrisma.socialAccount.update).not.toHaveBeenCalled();
  });
});

describe("TENANCY: an account is reachable only through the actor's own company", () => {
  it("2. another company's client is 'not found', never 'forbidden'", async () => {
    mockedPrisma.client.findUnique.mockResolvedValue({ id: CLIENT_ID, companyId: "company-2", name: "Someone else", deletedAt: null });
    const result = await addSocialAccountAction({ clientId: CLIENT_ID, platform: "FACEBOOK", handle: "sm" });
    expect(result.success).toBe(false);
    expect(!result.success && result.message).toBe("Client not found.");
    expect(mockedPrisma.socialAccount.create).not.toHaveBeenCalled();
  });

  it("3. another company's ACCOUNT cannot be edited, disabled or removed", async () => {
    mockedPrisma.socialAccount.findUnique.mockResolvedValue({
      id: ACCOUNT_ID,
      companyId: "company-2",
      clientId: OTHER_CLIENT_ID,
      platform: "FACEBOOK",
      handle: "theirs",
      deletedAt: null,
    });
    for (const result of [
      await updateSocialAccountAction({ accountId: ACCOUNT_ID, handle: "mine" }),
      await setSocialAccountStatusAction({ accountId: ACCOUNT_ID, status: "DISCONNECTED" }),
      await removeSocialAccountAction(ACCOUNT_ID),
    ]) {
      expect(result.success).toBe(false);
      expect(!result.success && result.message).toBe("Social account not found.");
    }
    expect(mockedPrisma.socialAccount.update).not.toHaveBeenCalled();
  });

  it("4. every read is scoped by companyId AND clientId in the query itself", async () => {
    await listClientSocialAccountsAction(CLIENT_ID);
    const [{ where }] = mockedPrisma.socialAccount.findMany.mock.calls[0];
    expect(where.companyId).toBe("company-1");
    expect(where.clientId).toBe(CLIENT_ID);
    expect(where.deletedAt).toBeNull();
  });

  it("5. a new account is created under the ACTOR'S company, not one supplied by the caller", async () => {
    await addSocialAccountAction({ clientId: CLIENT_ID, platform: "LINKEDIN", handle: "storage-moguls" });
    const [{ data }] = mockedPrisma.socialAccount.create.mock.calls[0];
    expect(data.companyId).toBe("company-1");
    expect(data.clientId).toBe(CLIENT_ID);
  });

  it("6. a malformed id is refused WITHOUT touching the database", async () => {
    for (const bad of ["", "not-a-uuid", "../etc/passwd", "1 OR 1=1"]) {
      mockedPrisma.client.findUnique.mockClear();
      mockedPrisma.socialAccount.findUnique.mockClear();
      expect((await addSocialAccountAction({ clientId: bad, platform: "X", handle: "sm" })).success).toBe(false);
      expect((await removeSocialAccountAction(bad)).success).toBe(false);
      expect(mockedPrisma.client.findUnique).not.toHaveBeenCalled();
      expect(mockedPrisma.socialAccount.findUnique).not.toHaveBeenCalled();
    }
  });

  it("7. a trashed client cannot have accounts added to it", async () => {
    mockedPrisma.client.findUnique.mockResolvedValue({ id: CLIENT_ID, companyId: "company-1", name: "Gone", deletedAt: new Date() });
    const result = await addSocialAccountAction({ clientId: CLIENT_ID, platform: "X", handle: "sm" });
    expect(result.success).toBe(false);
    expect(mockedPrisma.socialAccount.create).not.toHaveBeenCalled();
  });
});

describe("NO CREDENTIAL IS EVER ACCEPTED OR STORED", () => {
  it("8. a password smuggled into the input is not written — the schema has no such field", async () => {
    await addSocialAccountAction({
      clientId: CLIENT_ID,
      platform: "FACEBOOK",
      handle: "storagemoguls",
      ...({ password: "hunter2", accessToken: "tok_123", apiKey: "sk-live" } as object),
    });
    const [{ data }] = mockedPrisma.socialAccount.create.mock.calls[0];
    expect(Object.keys(data).sort()).toEqual(["clientId", "companyId", "displayName", "handle", "platform", "status"]);
  });

  it("9. what comes back to the browser carries no credential field either", async () => {
    const result = await listClientSocialAccountsAction(CLIENT_ID);
    expect(result.success).toBe(true);
    const account = result.success ? result.data[0] : null;
    /*
     * Phase 9 added connection fields, and this list is the assertion that
     * none of them is a credential: hasStoredCredential is a BOOLEAN, and
     * there is no encryptedPayload, no token, no scope list.
     */
    expect(Object.keys(account ?? {}).sort()).toEqual([
      "clientId",
      "connectedAt",
      "connectionState",
      "displayName",
      "externalId",
      "handle",
      "hasStoredCredential",
      "id",
      "lastCheckError",
      "lastCheckedAt",
      "platform",
      "status",
      "targetCount",
    ]);
    expect(typeof (account as { hasStoredCredential: unknown }).hasStoredCredential).toBe("boolean");
  });
});

describe("adding an account", () => {
  it("10. a handle is required and cannot be a URL or contain spaces", async () => {
    for (const handle of ["", "a", "https://facebook.com/storagemoguls", "storage moguls"]) {
      const result = await addSocialAccountAction({ clientId: CLIENT_ID, platform: "FACEBOOK", handle });
      expect(result.success, handle).toBe(false);
    }
    expect(mockedPrisma.socialAccount.create).not.toHaveBeenCalled();
  });

  it("11. a duplicate handle on the same platform is refused in words, not a database crash", async () => {
    mockedPrisma.socialAccount.findFirst.mockResolvedValue({ id: "existing", deletedAt: null });
    const result = await addSocialAccountAction({ clientId: CLIENT_ID, platform: "FACEBOOK", handle: "storagemoguls" });
    expect(result.success).toBe(false);
    expect(!result.success && result.message).toMatch(/already configured/i);
    expect(mockedPrisma.socialAccount.create).not.toHaveBeenCalled();
  });

  it("12. re-adding a previously removed account restores that row rather than duplicating it", async () => {
    mockedPrisma.socialAccount.findFirst.mockResolvedValue({ id: "soft-deleted", deletedAt: new Date() });
    const result = await addSocialAccountAction({ clientId: CLIENT_ID, platform: "FACEBOOK", handle: "storagemoguls" });
    expect(result.success).toBe(true);
    expect(mockedPrisma.socialAccount.create).not.toHaveBeenCalled();
    const [{ where, data }] = mockedPrisma.socialAccount.update.mock.calls[0];
    expect(where.id).toBe("soft-deleted");
    expect(data.deletedAt).toBeNull();
    expect(data.status).toBe("ACTIVE");
  });

  it("13. the display name is optional and stored as null when blank", async () => {
    await addSocialAccountAction({ clientId: CLIENT_ID, platform: "FACEBOOK", handle: "storagemoguls", displayName: "   " });
    const [{ data }] = mockedPrisma.socialAccount.create.mock.calls[0];
    expect(data.displayName).toBeNull();
  });

  it("14. adding is recorded in the activity log against the client", async () => {
    await addSocialAccountAction({ clientId: CLIENT_ID, platform: "FACEBOOK", handle: "storagemoguls" });
    expect(mockedLogActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "client.social_account_added", clientId: CLIENT_ID, companyId: "company-1" })
    );
  });
});

describe("editing an account", () => {
  it("15. the platform cannot be changed — only the handle and name", async () => {
    await updateSocialAccountAction({ accountId: ACCOUNT_ID, handle: "newhandle", displayName: "New Name" });
    const [{ data }] = mockedPrisma.socialAccount.update.mock.calls[0];
    expect(data).toEqual({ handle: "newhandle", displayName: "New Name" });
    expect(data).not.toHaveProperty("platform");
    expect(data).not.toHaveProperty("clientId");
    expect(data).not.toHaveProperty("companyId");
  });

  it("16. renaming onto another account's handle is refused", async () => {
    mockedPrisma.socialAccount.findFirst.mockResolvedValue({ id: "another" });
    const result = await updateSocialAccountAction({ accountId: ACCOUNT_ID, handle: "taken" });
    expect(result.success).toBe(false);
    expect(mockedPrisma.socialAccount.update).not.toHaveBeenCalled();
  });
});

describe("disabling never destroys planned work", () => {
  it("17. disabling only changes status — no content is touched", async () => {
    const result = await setSocialAccountStatusAction({ accountId: ACCOUNT_ID, status: "DISCONNECTED" });
    expect(result.success).toBe(true);
    const [{ data }] = mockedPrisma.socialAccount.update.mock.calls[0];
    expect(data).toEqual({ status: "DISCONNECTED" });
  });

  it("18. an account still targeted by a post is NOT removed — it says to disable it instead", async () => {
    mockedPrisma.socialPostTarget.count.mockResolvedValue(3);
    const result = await removeSocialAccountAction(ACCOUNT_ID);
    expect(result.success).toBe(false);
    expect(!result.success && result.message).toMatch(/3 saved posts already target this account/);
    expect(!result.success && result.message).toMatch(/Disable it instead/);
    expect(mockedPrisma.socialAccount.update).not.toHaveBeenCalled();
  });

  it("19. removal is a soft delete, so history stays readable", async () => {
    const result = await removeSocialAccountAction(ACCOUNT_ID);
    expect(result.success).toBe(true);
    const [{ data }] = mockedPrisma.socialAccount.update.mock.calls[0];
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(data.status).toBe("DISCONNECTED");
    /*
     * Phase 9 — the row survives, but its authorization does not. A
     * soft-deleted account still owning a decryptable token would be a
     * credential nothing on screen can see or revoke.
     */
    expect(data.connectionState).toBe("DISCONNECTED");
    expect(mockedPrisma.socialAccountCredential.deleteMany).toHaveBeenCalledWith({
      where: { socialAccountId: ACCOUNT_ID, companyId: "company-1" },
    });
  });

  it("20. enabling and disabling are logged distinctly", async () => {
    await setSocialAccountStatusAction({ accountId: ACCOUNT_ID, status: "DISCONNECTED" });
    expect(mockedLogActivity).toHaveBeenCalledWith(expect.objectContaining({ action: "client.social_account_disabled" }));
    mockedLogActivity.mockClear();
    await setSocialAccountStatusAction({ accountId: ACCOUNT_ID, status: "ACTIVE" });
    expect(mockedLogActivity).toHaveBeenCalledWith(expect.objectContaining({ action: "client.social_account_enabled" }));
  });
});
