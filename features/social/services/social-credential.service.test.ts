import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 9 — credential security, asserted rather than asserted-in-a-comment.
 *
 * A real key is set here so the real AES-256-GCM implementation runs. The
 * tests then check the properties that matter: what reaches the database is
 * unreadable, what comes back out is only ever the token itself, and a
 * publishing credential handed to the social path is refused.
 */
process.env.PUBLISHING_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

/*
 * `server-only` exists purely to make a build fail if a server module is
 * pulled into a client bundle. Under Vitest there is no bundler to please, so
 * it is stubbed rather than the import being removed — the guard belongs in
 * the source.
 */
vi.mock("server-only", () => ({}));

type MockPrisma = {
  socialAccountCredential: {
    upsert: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialAccountCredential: { upsert: vi.fn(), findUnique: vi.fn(), count: vi.fn(), deleteMany: vi.fn() },
  },
}));

import {
  deleteSocialCredential,
  hasStoredCredential,
  readAccessToken,
  storeSocialCredential,
} from "@/features/social/services/social-credential.service";
import { encryptCredentialPayload } from "@/lib/crypto/publishing-credential-crypto";
import { prisma } from "@/lib/prisma";

const mockedPrisma = prisma as unknown as MockPrisma;

const ACCOUNT_ID = "01a00003-0003-7003-b003-000000000003";
const COMPANY_ID = "company-1";
const OTHER_COMPANY_ID = "company-2";
const TOKEN = "EAAB-a-real-looking-page-token-value";

beforeEach(() => {
  vi.clearAllMocks();
  mockedPrisma.socialAccountCredential.upsert.mockResolvedValue({ id: "cred-1" });
  mockedPrisma.socialAccountCredential.deleteMany.mockResolvedValue({ count: 1 });
  mockedPrisma.socialAccountCredential.count.mockResolvedValue(0);
});

/** What the service actually asked the database to write. */
function writtenPayload(): { encryptedPayload: string; encryptionKeyVersion: number } {
  const [args] = mockedPrisma.socialAccountCredential.upsert.mock.calls[0];
  return args.create;
}

describe("a stored credential is never stored in the clear", () => {
  it("1. the token does not appear anywhere in what is written to the database", async () => {
    await storeSocialCredential({
      socialAccountId: ACCOUNT_ID,
      companyId: COMPANY_ID,
      accessToken: TOKEN,
      expiresAt: null,
      grantedScopes: ["pages_show_list"],
    });

    const [args] = mockedPrisma.socialAccountCredential.upsert.mock.calls[0];
    /* The whole call, not just the payload field — a token must not ride along anywhere. */
    expect(JSON.stringify(args)).not.toContain(TOKEN);
  });

  it("2. what is written is versioned ciphertext in the shared format", async () => {
    await storeSocialCredential({
      socialAccountId: ACCOUNT_ID,
      companyId: COMPANY_ID,
      accessToken: TOKEN,
      expiresAt: null,
      grantedScopes: [],
    });

    const payload = writtenPayload();
    expect(payload.encryptionKeyVersion).toBe(1);
    /* "v1:<iv>:<tag>:<ciphertext>" — the same envelope publishing already uses. */
    expect(payload.encryptedPayload.split(":")).toHaveLength(4);
    expect(payload.encryptedPayload.startsWith("v1:")).toBe(true);
  });

  it("3. the same token encrypts differently every time, so ciphertext is not a fingerprint", async () => {
    const shared = { socialAccountId: ACCOUNT_ID, companyId: COMPANY_ID, accessToken: TOKEN, expiresAt: null, grantedScopes: [] };
    await storeSocialCredential(shared);
    await storeSocialCredential(shared);

    const first = mockedPrisma.socialAccountCredential.upsert.mock.calls[0][0].create.encryptedPayload;
    const second = mockedPrisma.socialAccountCredential.upsert.mock.calls[1][0].create.encryptedPayload;
    expect(first).not.toEqual(second);
  });

  it("4. only a confirmed credential type is ever written", async () => {
    await storeSocialCredential({
      socialAccountId: ACCOUNT_ID,
      companyId: COMPANY_ID,
      accessToken: TOKEN,
      expiresAt: null,
      grantedScopes: [],
    });
    const [args] = mockedPrisma.socialAccountCredential.upsert.mock.calls[0];
    expect(args.create.credentialType).toBe("OAUTH2_ACCESS_TOKEN");
  });

  it("5. an expiry is recorded only when the provider stated one", async () => {
    await storeSocialCredential({
      socialAccountId: ACCOUNT_ID,
      companyId: COMPANY_ID,
      accessToken: TOKEN,
      expiresAt: null,
      grantedScopes: [],
    });
    expect(writtenPayload()).toMatchObject({ encryptionKeyVersion: 1 });
    const [first] = mockedPrisma.socialAccountCredential.upsert.mock.calls[0];
    expect(first.create.expiresAt).toBeNull();

    const stated = new Date("2026-11-01T00:00:00.000Z");
    await storeSocialCredential({
      socialAccountId: ACCOUNT_ID,
      companyId: COMPANY_ID,
      accessToken: TOKEN,
      expiresAt: stated,
      grantedScopes: [],
    });
    const [second] = mockedPrisma.socialAccountCredential.upsert.mock.calls[1];
    expect(second.create.expiresAt).toEqual(stated);
  });
});

describe("reading a credential back", () => {
  function storedRow(companyId: string, plaintext: string) {
    const { encryptedPayload, encryptionKeyVersion } = encryptCredentialPayload(plaintext);
    return { companyId, encryptedPayload, encryptionKeyVersion };
  }

  it("6. a round trip returns exactly the token and nothing else", async () => {
    mockedPrisma.socialAccountCredential.findUnique.mockResolvedValue(
      storedRow(COMPANY_ID, JSON.stringify({ kind: "social_oauth2", v: 1, accessToken: TOKEN }))
    );
    await expect(readAccessToken(ACCOUNT_ID, COMPANY_ID)).resolves.toBe(TOKEN);
  });

  it("7. ANOTHER COMPANY'S credential is not readable, and reads as absent", async () => {
    mockedPrisma.socialAccountCredential.findUnique.mockResolvedValue(
      storedRow(OTHER_COMPANY_ID, JSON.stringify({ kind: "social_oauth2", v: 1, accessToken: TOKEN }))
    );
    /* Null, not a throw: "not yours" and "does not exist" must be indistinguishable. */
    await expect(readAccessToken(ACCOUNT_ID, COMPANY_ID)).resolves.toBeNull();
  });

  it("8. a missing credential row reads as absent rather than failing", async () => {
    mockedPrisma.socialAccountCredential.findUnique.mockResolvedValue(null);
    await expect(readAccessToken(ACCOUNT_ID, COMPANY_ID)).resolves.toBeNull();
  });

  it("9. a WORDPRESS credential is refused even though the key decrypts it", async () => {
    /*
     * This is the logical separation from publishing, tested end to end: the
     * payload really is decryptable — same master key — but it carries no
     * social envelope tag, so it must not be used as a social credential.
     */
    mockedPrisma.socialAccountCredential.findUnique.mockResolvedValue(
      storedRow(COMPANY_ID, JSON.stringify({ username: "admin", applicationPassword: "abcd efgh" }))
    );
    await expect(readAccessToken(ACCOUNT_ID, COMPANY_ID)).rejects.toThrow(/not a social credential/i);
  });

  it("10. an envelope from a future version is refused rather than guessed at", async () => {
    mockedPrisma.socialAccountCredential.findUnique.mockResolvedValue(
      storedRow(COMPANY_ID, JSON.stringify({ kind: "social_oauth2", v: 2, accessToken: TOKEN }))
    );
    await expect(readAccessToken(ACCOUNT_ID, COMPANY_ID)).rejects.toThrow(/not a social credential/i);
  });

  it("11. tampered ciphertext fails closed, and the error names no secret", async () => {
    const row = storedRow(COMPANY_ID, JSON.stringify({ kind: "social_oauth2", v: 1, accessToken: TOKEN }));
    const parts = row.encryptedPayload.split(":");
    /* Flip the ciphertext. AES-GCM's auth tag must reject it. */
    parts[3] = Buffer.from("tampered-ciphertext-value").toString("base64");
    mockedPrisma.socialAccountCredential.findUnique.mockResolvedValue({ ...row, encryptedPayload: parts.join(":") });

    await expect(readAccessToken(ACCOUNT_ID, COMPANY_ID)).rejects.toThrow();
    await readAccessToken(ACCOUNT_ID, COMPANY_ID).catch((error: unknown) => {
      expect(String(error)).not.toContain(TOKEN);
    });
  });

  it("12. unreadable plaintext produces an error that does not echo the plaintext", async () => {
    mockedPrisma.socialAccountCredential.findUnique.mockResolvedValue(storedRow(COMPANY_ID, "not-json-at-all"));
    await expect(readAccessToken(ACCOUNT_ID, COMPANY_ID)).rejects.toThrow(/not readable/i);
    await readAccessToken(ACCOUNT_ID, COMPANY_ID).catch((error: unknown) => {
      expect(String(error)).not.toContain("not-json-at-all");
    });
  });
});

describe("existence and removal", () => {
  it("13. existence is company-scoped and decrypts nothing", async () => {
    mockedPrisma.socialAccountCredential.count.mockResolvedValue(1);
    await expect(hasStoredCredential(ACCOUNT_ID, COMPANY_ID)).resolves.toBe(true);
    expect(mockedPrisma.socialAccountCredential.count).toHaveBeenCalledWith({
      where: { socialAccountId: ACCOUNT_ID, companyId: COMPANY_ID },
    });
    expect(mockedPrisma.socialAccountCredential.findUnique).not.toHaveBeenCalled();
  });

  it("14. deleting is company-scoped, so one company cannot revoke another's", async () => {
    await deleteSocialCredential(ACCOUNT_ID, COMPANY_ID);
    expect(mockedPrisma.socialAccountCredential.deleteMany).toHaveBeenCalledWith({
      where: { socialAccountId: ACCOUNT_ID, companyId: COMPANY_ID },
    });
  });
});
