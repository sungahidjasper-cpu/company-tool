import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/crypto/publishing-credential-crypto", () => ({ decryptCredentialPayload: vi.fn() }));
vi.mock("@/features/publishing/services/wordpress-publish.service", () => ({ publishContentToWordPress: vi.fn() }));

type MockPrisma = {
  content: { findUnique: ReturnType<typeof vi.fn> };
  publishingConnection: { findUnique: ReturnType<typeof vi.fn> };
  publishingJob: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  publishingAttempt: { count: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  contentPublication: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  $queryRaw: ReturnType<typeof vi.fn>;
  $transaction: ReturnType<typeof vi.fn>;
};

function createMockPrisma(): MockPrisma {
  const prisma = {
    content: { findUnique: vi.fn() },
    publishingConnection: { findUnique: vi.fn() },
    publishingJob: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    publishingAttempt: { count: vi.fn().mockResolvedValue(0), create: vi.fn() },
    contentPublication: { findUnique: vi.fn(), create: vi.fn() },
    $queryRaw: vi.fn().mockResolvedValue(undefined),
  } as unknown as MockPrisma;
  prisma.$transaction = vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") return (arg as (tx: MockPrisma) => unknown)(prisma);
    return Promise.all(arg as Promise<unknown>[]);
  });
  return prisma;
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { requireUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { decryptCredentialPayload } from "@/lib/crypto/publishing-credential-crypto";
import { prisma } from "@/lib/prisma";
import { publishContentToWordPress } from "@/features/publishing/services/wordpress-publish.service";
import { publishContentAction, retryPublishAction } from "@/features/publishing/actions/publishing-content.actions";

const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedDecrypt = decryptCredentialPayload as unknown as ReturnType<typeof vi.fn>;
const mockedPublish = publishContentToWordPress as unknown as ReturnType<typeof vi.fn>;
const mockedPrisma = prisma as unknown as MockPrisma;

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";

const MANAGER = { id: "user-1", role: "MANAGER", companyId: COMPANY_A };
const EMPLOYEE = { id: "user-2", role: "EMPLOYEE", companyId: COMPANY_A };

function makeContent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "content-1",
    title: "My Article",
    body: "# Body",
    status: "APPROVED",
    deletedAt: null,
    seoProject: { companyId: COMPANY_A },
    ...overrides,
  };
}

function makeConnection(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "connection-1",
    baseUrl: "https://blog.example.com",
    providerType: "WORDPRESS",
    status: "ACTIVE",
    companyId: COMPANY_A,
    credential: { encryptedPayload: "v1:iv:tag:ct", encryptionKeyVersion: 1 },
    ...overrides,
  };
}

describe("publishContentAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.content.findUnique.mockResolvedValue(makeContent());
    mockedPrisma.publishingConnection.findUnique.mockResolvedValue(makeConnection());
    mockedPrisma.contentPublication.findUnique.mockResolvedValue(null);
    mockedPrisma.publishingJob.findFirst.mockResolvedValue(null);
    mockedPrisma.publishingJob.create.mockResolvedValue({ id: "job-1" });
    mockedDecrypt.mockReturnValue(JSON.stringify({ username: "admin", applicationPassword: "abcd 1234 EFGH 5678" }));
  });

  it("denies an EMPLOYEE", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await publishContentAction({ contentId: "content-1", connectionId: "connection-1" });
    expect(result.success).toBe(false);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("allows a MANAGER through to a successful publish", async () => {
    mockedPublish.mockResolvedValue({ ok: true, externalId: "42", externalUrl: "https://blog.example.com/?p=42", externalStatus: "publish" });
    mockedPrisma.contentPublication.create.mockResolvedValue({ externalId: "42", externalUrl: "https://blog.example.com/?p=42", publishedAt: new Date() });

    const result = await publishContentAction({ contentId: "content-1", connectionId: "connection-1" });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.externalId).toBe("42");
      expect(result.data.alreadyPublished).toBe(false);
    }
  });

  it("rejects when the actor's company differs from the Content's company", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(makeContent({ seoProject: { companyId: COMPANY_B } }));
    const result = await publishContentAction({ contentId: "content-1", connectionId: "connection-1" });
    expect(result.success).toBe(false);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("rejects when the actor's company differs from the connection's company", async () => {
    mockedPrisma.publishingConnection.findUnique.mockResolvedValue(makeConnection({ companyId: COMPANY_B }));
    const result = await publishContentAction({ contentId: "content-1", connectionId: "connection-1" });
    expect(result.success).toBe(false);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("the explicit content-vs-connection company check never false-positives when both genuinely share a company", async () => {
    // Given getPublishableContent/getEligibleConnection each already scope
    // by actor.companyId, a non-null content and a non-null connection are
    // mathematically guaranteed to share the same company as the actor —
    // and therefore as each other — so the explicit third-leg comparison
    // in the action is unreachable-as-a-failure under the current lookups.
    // It exists as defense-in-depth (a regression guard if a lookup is ever
    // changed to stop scoping by company), not as the primary guarantee.
    // This test confirms it doesn't accidentally reject a genuinely
    // same-company pair.
    const sharedCompany = "company-shared";
    mockedRequireUser.mockResolvedValue({ id: "u", role: "MANAGER", companyId: sharedCompany });
    mockedPrisma.content.findUnique.mockResolvedValue(makeContent({ seoProject: { companyId: sharedCompany } }));
    mockedPrisma.publishingConnection.findUnique.mockResolvedValue(makeConnection({ companyId: sharedCompany }));
    mockedPublish.mockResolvedValue({ ok: true, externalId: "1", externalUrl: "https://x/?p=1", externalStatus: "publish" });
    mockedPrisma.contentPublication.create.mockResolvedValue({ externalId: "1", externalUrl: "https://x/?p=1", publishedAt: new Date() });

    const result = await publishContentAction({ contentId: "content-1", connectionId: "connection-1" });

    expect(result.success).toBe(true);
    expect(mockedPublish).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing Content", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(null);
    const result = await publishContentAction({ contentId: "content-1", connectionId: "connection-1" });
    expect(result.success).toBe(false);
  });

  it("rejects a soft-deleted Content", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(makeContent({ deletedAt: new Date() }));
    const result = await publishContentAction({ contentId: "content-1", connectionId: "connection-1" });
    expect(result.success).toBe(false);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("rejects Content with no body", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(makeContent({ body: null }));
    const result = await publishContentAction({ contentId: "content-1", connectionId: "connection-1" });
    expect(result.success).toBe(false);
  });

  it("rejects DRAFT and IN_REVIEW Content", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(makeContent({ status: "DRAFT" }));
    expect((await publishContentAction({ contentId: "content-1", connectionId: "connection-1" })).success).toBe(false);

    mockedPrisma.content.findUnique.mockResolvedValue(makeContent({ status: "IN_REVIEW" }));
    expect((await publishContentAction({ contentId: "content-1", connectionId: "connection-1" })).success).toBe(false);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("accepts APPROVED Content", async () => {
    mockedPublish.mockResolvedValue({ ok: true, externalId: "1", externalUrl: "https://blog.example.com/?p=1", externalStatus: "publish" });
    mockedPrisma.contentPublication.create.mockResolvedValue({ externalId: "1", externalUrl: "https://blog.example.com/?p=1", publishedAt: new Date() });
    const result = await publishContentAction({ contentId: "content-1", connectionId: "connection-1" });
    expect(result.success).toBe(true);
  });

  it("rejects a missing connection", async () => {
    mockedPrisma.publishingConnection.findUnique.mockResolvedValue(null);
    const result = await publishContentAction({ contentId: "content-1", connectionId: "connection-1" });
    expect(result.success).toBe(false);
  });

  it("rejects a REVOKED connection", async () => {
    mockedPrisma.publishingConnection.findUnique.mockResolvedValue(makeConnection({ status: "REVOKED" }));
    const result = await publishContentAction({ contentId: "content-1", connectionId: "connection-1" });
    expect(result.success).toBe(false);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("rejects an INVALID connection", async () => {
    mockedPrisma.publishingConnection.findUnique.mockResolvedValue(makeConnection({ status: "INVALID" }));
    const result = await publishContentAction({ contentId: "content-1", connectionId: "connection-1" });
    expect(result.success).toBe(false);
  });

  it("rejects a connection with no stored credential", async () => {
    mockedPrisma.publishingConnection.findUnique.mockResolvedValue(makeConnection({ credential: null }));
    const result = await publishContentAction({ contentId: "content-1", connectionId: "connection-1" });
    expect(result.success).toBe(false);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("blocks the external call entirely when a ContentPublication already exists (idempotency)", async () => {
    mockedPrisma.contentPublication.findUnique.mockResolvedValue({
      externalId: "1",
      externalUrl: "https://blog.example.com/?p=1",
      publishedAt: new Date(),
    });

    const result = await publishContentAction({ contentId: "content-1", connectionId: "connection-1" });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.alreadyPublished).toBe(true);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("blocks a second first-attempt publish when a PublishingJob already exists for the pair", async () => {
    mockedPrisma.publishingJob.findFirst.mockResolvedValue({ id: "job-existing", status: "FAILED" });

    const result = await publishContentAction({ contentId: "content-1", connectionId: "connection-1" });

    expect(result.success).toBe(false);
    expect(mockedPublish).not.toHaveBeenCalled();
    expect(mockedPrisma.publishingJob.create).not.toHaveBeenCalled();
  });

  it("locks the Content row inside the same transaction as the idempotency check (concurrency strategy)", async () => {
    mockedPublish.mockResolvedValue({ ok: true, externalId: "1", externalUrl: "https://x/?p=1", externalStatus: "publish" });
    mockedPrisma.contentPublication.create.mockResolvedValue({ externalId: "1", externalUrl: "https://x/?p=1", publishedAt: new Date() });

    await publishContentAction({ contentId: "content-1", connectionId: "connection-1" });

    expect(mockedPrisma.$queryRaw).toHaveBeenCalled();
  });

  it("records a confirmed FAILURE without creating a ContentPublication", async () => {
    mockedPublish.mockResolvedValue({ ok: false, errorType: "AUTHENTICATION_FAILED", message: "The destination rejected these credentials." });

    const result = await publishContentAction({ contentId: "content-1", connectionId: "connection-1" });

    expect(result.success).toBe(false);
    expect(mockedPrisma.contentPublication.create).not.toHaveBeenCalled();
    expect(mockedPrisma.publishingJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED", errorType: "AUTHENTICATION_FAILED" }) })
    );
  });

  it("records AMBIGUOUS_RESPONSE as a FAILED job without creating a ContentPublication, and does not auto-retry", async () => {
    mockedPublish.mockResolvedValue({ ok: false, errorType: "AMBIGUOUS_RESPONSE", message: "Could not confirm the outcome." });

    const result = await publishContentAction({ contentId: "content-1", connectionId: "connection-1" });

    expect(result.success).toBe(false);
    expect(mockedPrisma.contentPublication.create).not.toHaveBeenCalled();
    expect(mockedPublish).toHaveBeenCalledTimes(1); // exactly one attempt — no automatic second call
  });

  it("never exposes the decrypted credential in the returned result, thrown errors, or logged activity", async () => {
    mockedPublish.mockResolvedValue({ ok: false, errorType: "UNKNOWN", message: "unexpected" });

    const result = await publishContentAction({ contentId: "content-1", connectionId: "connection-1" });

    const serialized = JSON.stringify(result) + JSON.stringify((logActivity as ReturnType<typeof vi.fn>).mock.calls);
    expect(serialized).not.toContain("abcd 1234 EFGH 5678");
    expect(serialized).not.toContain("admin");
  });

  it("decrypts the credential only immediately before calling the publish service, never earlier", async () => {
    mockedPublish.mockResolvedValue({ ok: true, externalId: "1", externalUrl: "https://x/?p=1", externalStatus: "publish" });
    mockedPrisma.contentPublication.create.mockResolvedValue({ externalId: "1", externalUrl: "https://x/?p=1", publishedAt: new Date() });

    await publishContentAction({ contentId: "content-1", connectionId: "connection-1" });

    expect(mockedDecrypt).toHaveBeenCalledTimes(1);
    expect(mockedPublish).toHaveBeenCalledWith(
      "https://blog.example.com",
      { username: "admin", applicationPassword: "abcd 1234 EFGH 5678" },
      expect.objectContaining({ title: "My Article" }),
      "publish"
    );
  });
});

describe("retryPublishAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.content.findUnique.mockResolvedValue(makeContent());
    mockedPrisma.publishingConnection.findUnique.mockResolvedValue(makeConnection());
    mockedPrisma.contentPublication.findUnique.mockResolvedValue(null);
    mockedDecrypt.mockReturnValue(JSON.stringify({ username: "admin", applicationPassword: "abcd 1234 EFGH 5678" }));
  });

  it("denies an EMPLOYEE", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await retryPublishAction({ contentId: "content-1", connectionId: "connection-1" });
    expect(result.success).toBe(false);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("rejects when no prior job exists", async () => {
    mockedPrisma.publishingJob.findFirst.mockResolvedValue(null);
    const result = await retryPublishAction({ contentId: "content-1", connectionId: "connection-1" });
    expect(result.success).toBe(false);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("rejects retrying a job that is still PENDING or RUNNING", async () => {
    mockedPrisma.publishingJob.findFirst.mockResolvedValue({ id: "job-1", status: "RUNNING" });
    const result = await retryPublishAction({ contentId: "content-1", connectionId: "connection-1" });
    expect(result.success).toBe(false);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("rejects retrying an AMBIGUOUS_RESPONSE failure automatically", async () => {
    mockedPrisma.publishingJob.findFirst.mockResolvedValue({ id: "job-1", status: "FAILED", errorType: "AMBIGUOUS_RESPONSE" });
    const result = await retryPublishAction({ contentId: "content-1", connectionId: "connection-1" });
    expect(result.success).toBe(false);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("rejects retrying a received 4xx/5xx failure automatically", async () => {
    mockedPrisma.publishingJob.findFirst.mockResolvedValue({ id: "job-1", status: "FAILED", errorType: "DESTINATION_UNAVAILABLE" });
    const result1 = await retryPublishAction({ contentId: "content-1", connectionId: "connection-1" });
    expect(result1.success).toBe(false);

    mockedPrisma.publishingJob.findFirst.mockResolvedValue({ id: "job-1", status: "FAILED", errorType: "AUTHENTICATION_FAILED" });
    const result2 = await retryPublishAction({ contentId: "content-1", connectionId: "connection-1" });
    expect(result2.success).toBe(false);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("permits retrying a confirmed safe NETWORK_TIMEOUT failure", async () => {
    mockedPrisma.publishingJob.findFirst.mockResolvedValue({ id: "job-1", status: "FAILED", errorType: "NETWORK_TIMEOUT" });
    mockedPrisma.publishingAttempt.count.mockResolvedValue(1);
    mockedPublish.mockResolvedValue({ ok: true, externalId: "1", externalUrl: "https://x/?p=1", externalStatus: "publish" });
    mockedPrisma.contentPublication.create.mockResolvedValue({ externalId: "1", externalUrl: "https://x/?p=1", publishedAt: new Date() });

    const result = await retryPublishAction({ contentId: "content-1", connectionId: "connection-1" });

    expect(mockedPublish).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
  });

  it("claims the job (FAILED -> RUNNING) exactly once, inside the locked pre-flight transaction, and executeAttempt does not perform a second competing claim", async () => {
    mockedPrisma.publishingJob.findFirst.mockResolvedValue({ id: "job-1", status: "FAILED", errorType: "NETWORK_TIMEOUT" });
    mockedPrisma.publishingAttempt.count.mockResolvedValue(1);
    mockedPublish.mockResolvedValue({ ok: true, externalId: "1", externalUrl: "https://x/?p=1", externalStatus: "publish" });
    mockedPrisma.contentPublication.create.mockResolvedValue({ externalId: "1", externalUrl: "https://x/?p=1", publishedAt: new Date() });

    await retryPublishAction({ contentId: "content-1", connectionId: "connection-1" });

    const runningClaims = (
      mockedPrisma.publishingJob.update.mock.calls as [{ where: { id: string }; data: { status?: string } }][]
    ).filter(([args]) => args.data.status === "RUNNING");
    expect(runningClaims).toHaveLength(1);
    expect(runningClaims[0][0].where.id).toBe("job-1");
  });

  it("regression: a second retry attempt observing the job already RUNNING (as the first retry's atomic claim would leave it) is rejected before any WordPress call — the concurrency gap identified in the Stage 2C audit is closed", async () => {
    // Models the state a second, concurrent retryPublishAction call would
    // see AFTER the first has already run its locked claim transaction and
    // committed: status is RUNNING, not FAILED, so the retry gate must
    // reject it as in-progress rather than re-evaluating retryability and
    // proceeding to call WordPress a second time.
    mockedPrisma.publishingJob.findFirst.mockResolvedValue({ id: "job-1", status: "RUNNING", errorType: "NETWORK_TIMEOUT" });

    const result = await retryPublishAction({ contentId: "content-1", connectionId: "connection-1" });

    expect(result.success).toBe(false);
    expect(mockedPublish).not.toHaveBeenCalled();
    expect(mockedPrisma.publishingJob.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "RUNNING" }) }));
  });

  it("re-validates ownership on retry even if the original job would have passed", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(makeContent({ seoProject: { companyId: COMPANY_B } }));
    mockedPrisma.publishingJob.findFirst.mockResolvedValue({ id: "job-1", status: "FAILED", errorType: "NETWORK_TIMEOUT" });

    const result = await retryPublishAction({ contentId: "content-1", connectionId: "connection-1" });

    expect(result.success).toBe(false);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("re-checks ContentPublication on retry — a since-completed publication blocks the retry", async () => {
    mockedPrisma.contentPublication.findUnique.mockResolvedValue({
      externalId: "1",
      externalUrl: "https://x/?p=1",
      publishedAt: new Date(),
    });

    const result = await retryPublishAction({ contentId: "content-1", connectionId: "connection-1" });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.alreadyPublished).toBe(true);
    expect(mockedPublish).not.toHaveBeenCalled();
  });
});
