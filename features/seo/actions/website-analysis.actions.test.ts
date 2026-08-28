import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/features/seo/services/website-analysis.service", () => ({
  startWebsiteAnalysis: vi.fn(),
  getWebsiteAnalysisJobById: vi.fn(),
  retryWebsiteAnalysis: vi.fn(),
  duplicateWebsiteAnalysis: vi.fn(),
}));

import { requireUser } from "@/lib/auth";
import {
  startWebsiteAnalysis,
  getWebsiteAnalysisJobById,
  retryWebsiteAnalysis,
  duplicateWebsiteAnalysis,
} from "@/features/seo/services/website-analysis.service";
import {
  startWebsiteAnalysisAction,
  getWebsiteAnalysisJobAction,
  retryWebsiteAnalysisAction,
  duplicateWebsiteAnalysisAction,
} from "@/features/seo/actions/website-analysis.actions";

const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedStartWebsiteAnalysis = startWebsiteAnalysis as unknown as ReturnType<typeof vi.fn>;
const mockedGetWebsiteAnalysisJobById = getWebsiteAnalysisJobById as unknown as ReturnType<typeof vi.fn>;
const mockedRetryWebsiteAnalysis = retryWebsiteAnalysis as unknown as ReturnType<typeof vi.fn>;
const mockedDuplicateWebsiteAnalysis = duplicateWebsiteAnalysis as unknown as ReturnType<typeof vi.fn>;

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";
const MANAGER = { id: "user-1", role: "MANAGER", companyId: COMPANY_A };
const EMPLOYEE = { id: "user-2", role: "EMPLOYEE", companyId: COMPANY_A };

function makeJob(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "job-1",
    companyId: COMPANY_A,
    domain: "acme.example",
    status: "SUCCEEDED",
    crawlResultJson: { pages: [] },
    crawlHash: "hash-1",
    seoProjectId: null,
    clientId: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequireUser.mockResolvedValue(MANAGER);
  mockedStartWebsiteAnalysis.mockResolvedValue(makeJob({ id: "new-job-1" }));
  mockedGetWebsiteAnalysisJobById.mockResolvedValue(makeJob());
  mockedRetryWebsiteAnalysis.mockResolvedValue(undefined);
  mockedDuplicateWebsiteAnalysis.mockResolvedValue(makeJob({ id: "duplicate-job-1" }));
});

describe("startWebsiteAnalysisAction", () => {
  it("1. rejects an EMPLOYEE — below the manageSeoProjects (MANAGER) minimum", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await startWebsiteAnalysisAction({ domain: "acme.example" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to run a website analysis.");
    expect(mockedStartWebsiteAnalysis).not.toHaveBeenCalled();
  });

  it("2. succeeds for a MANAGER", async () => {
    const result = await startWebsiteAnalysisAction({ domain: "acme.example" });
    expect(result.success).toBe(true);
  });

  it("3. rejects invalid input (domain too short) without calling the service", async () => {
    const result = await startWebsiteAnalysisAction({ domain: "ab" });
    expect(result.success).toBe(false);
    expect(mockedStartWebsiteAnalysis).not.toHaveBeenCalled();
  });

  it("4. calls startWebsiteAnalysis with the server-derived companyId, never a client-supplied one", async () => {
    await startWebsiteAnalysisAction({ domain: "acme.example", seoProjectId: "seo-1" });
    expect(mockedStartWebsiteAnalysis).toHaveBeenCalledWith({
      companyId: MANAGER.companyId,
      domain: "acme.example",
      seoProjectId: "seo-1",
      clientId: undefined,
    });
  });

  it("5. uses a different actor's companyId when that actor belongs to a different company", async () => {
    const otherManager = { id: "user-9", role: "MANAGER", companyId: COMPANY_B };
    mockedRequireUser.mockResolvedValue(otherManager);
    await startWebsiteAnalysisAction({ domain: "acme.example" });
    expect(mockedStartWebsiteAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: COMPANY_B })
    );
  });

  it("6. returns the new job's id", async () => {
    mockedStartWebsiteAnalysis.mockResolvedValue(makeJob({ id: "new-job-1" }));
    const result = await startWebsiteAnalysisAction({ domain: "acme.example" });
    expect(result).toEqual({ success: true, data: { id: "new-job-1" } });
  });

  it("7. [characterization — documents current production behavior] a seoProjectId belonging to another company is accepted without any tenant validation, because none exists in production", async () => {
    const result = await startWebsiteAnalysisAction({ domain: "acme.example", seoProjectId: "seo-from-company-b" });
    expect(result.success).toBe(true);
    expect(mockedStartWebsiteAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: MANAGER.companyId, seoProjectId: "seo-from-company-b" })
    );
  });

  it("8. [characterization — documents current production behavior] a clientId belonging to another company is accepted without any tenant validation, because none exists in production", async () => {
    const result = await startWebsiteAnalysisAction({ domain: "acme.example", clientId: "client-from-company-b" });
    expect(result.success).toBe(true);
    expect(mockedStartWebsiteAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: MANAGER.companyId, clientId: "client-from-company-b" })
    );
  });

  it("9. a matching-company seoProjectId/clientId combination succeeds identically — the action takes no different path for it than for the untrusted values above, because it never distinguishes them", async () => {
    const result = await startWebsiteAnalysisAction({
      domain: "acme.example",
      seoProjectId: "seo-belonging-to-company-a",
      clientId: "client-belonging-to-company-a",
    });
    expect(result.success).toBe(true);
    expect(mockedStartWebsiteAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: MANAGER.companyId,
        seoProjectId: "seo-belonging-to-company-a",
        clientId: "client-belonging-to-company-a",
      })
    );
  });

  it("10. [characterization] the exact payload forwarded to startWebsiteAnalysis for an untrusted seoProjectId/clientId is identical in shape to a same-company call — no separate ownership-verification field, flag, or lookup result is threaded through", async () => {
    await startWebsiteAnalysisAction({
      domain: "acme.example",
      seoProjectId: "seo-from-company-b",
      clientId: "client-from-company-b",
    });
    expect(mockedStartWebsiteAnalysis).toHaveBeenCalledWith({
      companyId: MANAGER.companyId,
      domain: "acme.example",
      seoProjectId: "seo-from-company-b",
      clientId: "client-from-company-b",
    });
    expect(mockedStartWebsiteAnalysis).toHaveBeenCalledTimes(1);
  });
});

describe("getWebsiteAnalysisJobAction", () => {
  // No Permissions gate exists in production for this action (any authenticated
  // actor may poll a job belonging to their own company) — matching the
  // AI-generation job poller's pattern. No role-gate test is added here, since
  // production has no such gate to protect.

  it("1. looks up the job by the given id", async () => {
    await getWebsiteAnalysisJobAction("job-1");
    expect(mockedGetWebsiteAnalysisJobById).toHaveBeenCalledWith("job-1");
  });

  it("2. returns 'Website analysis job not found.' for a missing job", async () => {
    mockedGetWebsiteAnalysisJobById.mockResolvedValue(null);
    const result = await getWebsiteAnalysisJobAction("missing");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Website analysis job not found.");
  });

  it("3. returns 'Website analysis job not found.' for a job belonging to a different company (tenant isolation) — the production companyId comparison runs for real", async () => {
    mockedGetWebsiteAnalysisJobById.mockResolvedValue(makeJob({ companyId: COMPANY_B }));
    const result = await getWebsiteAnalysisJobAction("job-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Website analysis job not found.");
  });

  it("4. returns the job when it belongs to the actor's own company", async () => {
    const job = makeJob({ id: "job-1", companyId: COMPANY_A, status: "RUNNING" });
    mockedGetWebsiteAnalysisJobById.mockResolvedValue(job);
    const result = await getWebsiteAnalysisJobAction("job-1");
    expect(result).toEqual({ success: true, data: job });
  });
});

describe("retryWebsiteAnalysisAction", () => {
  it("1. rejects an EMPLOYEE before ever looking up the job", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await retryWebsiteAnalysisAction("job-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to run a website analysis.");
    expect(mockedGetWebsiteAnalysisJobById).not.toHaveBeenCalled();
    expect(mockedRetryWebsiteAnalysis).not.toHaveBeenCalled();
  });

  it("2. returns 'Website analysis job not found.' for a missing job", async () => {
    mockedGetWebsiteAnalysisJobById.mockResolvedValue(null);
    const result = await retryWebsiteAnalysisAction("missing");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Website analysis job not found.");
    expect(mockedRetryWebsiteAnalysis).not.toHaveBeenCalled();
  });

  it("3. returns 'Website analysis job not found.' for a cross-company job (tenant isolation)", async () => {
    mockedGetWebsiteAnalysisJobById.mockResolvedValue(makeJob({ companyId: COMPANY_B }));
    const result = await retryWebsiteAnalysisAction("job-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Website analysis job not found.");
    expect(mockedRetryWebsiteAnalysis).not.toHaveBeenCalled();
  });

  it("4. [business-rule gate] rejects retry when crawlResultJson is absent, without calling retryWebsiteAnalysis", async () => {
    mockedGetWebsiteAnalysisJobById.mockResolvedValue(makeJob({ crawlResultJson: null }));
    const result = await retryWebsiteAnalysisAction("job-1");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.message).toBe("Nothing to retry for this analysis — start a new one instead.");
    }
    expect(mockedRetryWebsiteAnalysis).not.toHaveBeenCalled();
  });

  it("5. [business-rule gate] allows retry when crawlResultJson is present, and calls retryWebsiteAnalysis with the exact job", async () => {
    const job = makeJob({ crawlResultJson: { pages: [{ url: "https://acme.example" }] } });
    mockedGetWebsiteAnalysisJobById.mockResolvedValue(job);

    const result = await retryWebsiteAnalysisAction("job-1");

    expect(mockedRetryWebsiteAnalysis).toHaveBeenCalledWith(job);
    expect(mockedRetryWebsiteAnalysis).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true, data: { id: job.id } });
  });

  it("6. does not falsely allow retry for a same-company job whose crawlResultJson is present but the job otherwise belongs to another company", async () => {
    // Ensures the tenant check and the business-rule gate are independent
    // conditions, not accidentally coupled to each other.
    mockedGetWebsiteAnalysisJobById.mockResolvedValue(
      makeJob({ companyId: COMPANY_B, crawlResultJson: { pages: [] } })
    );
    const result = await retryWebsiteAnalysisAction("job-1");
    expect(result.success).toBe(false);
    expect(mockedRetryWebsiteAnalysis).not.toHaveBeenCalled();
  });
});

describe("duplicateWebsiteAnalysisAction", () => {
  it("1. rejects an EMPLOYEE before ever looking up the source job", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await duplicateWebsiteAnalysisAction("job-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to run a website analysis.");
    expect(mockedGetWebsiteAnalysisJobById).not.toHaveBeenCalled();
    expect(mockedDuplicateWebsiteAnalysis).not.toHaveBeenCalled();
  });

  it("2. returns 'Website analysis job not found.' for a missing source job", async () => {
    mockedGetWebsiteAnalysisJobById.mockResolvedValue(null);
    const result = await duplicateWebsiteAnalysisAction("missing");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Website analysis job not found.");
    expect(mockedDuplicateWebsiteAnalysis).not.toHaveBeenCalled();
  });

  it("3. returns 'Website analysis job not found.' for a source job belonging to a different company (tenant isolation)", async () => {
    mockedGetWebsiteAnalysisJobById.mockResolvedValue(makeJob({ companyId: COMPANY_B }));
    const result = await duplicateWebsiteAnalysisAction("job-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Website analysis job not found.");
    expect(mockedDuplicateWebsiteAnalysis).not.toHaveBeenCalled();
  });

  it("4. succeeds for a source job belonging to the actor's own company", async () => {
    const result = await duplicateWebsiteAnalysisAction("job-1");
    expect(result.success).toBe(true);
  });

  it("5. forwards the exact resolved source job to duplicateWebsiteAnalysis (the action does not reconstruct fields itself)", async () => {
    const sourceJob = makeJob({
      id: "job-1",
      domain: "acme.example",
      seoProjectId: "seo-1",
      clientId: "client-1",
    });
    mockedGetWebsiteAnalysisJobById.mockResolvedValue(sourceJob);

    await duplicateWebsiteAnalysisAction("job-1");

    expect(mockedDuplicateWebsiteAnalysis).toHaveBeenCalledWith(sourceJob);
    expect(mockedDuplicateWebsiteAnalysis).toHaveBeenCalledTimes(1);
  });

  it("6. returns the newly created duplicate job's id", async () => {
    mockedDuplicateWebsiteAnalysis.mockResolvedValue(makeJob({ id: "duplicate-job-1" }));
    const result = await duplicateWebsiteAnalysisAction("job-1");
    expect(result).toEqual({ success: true, data: { id: "duplicate-job-1" } });
  });
});
