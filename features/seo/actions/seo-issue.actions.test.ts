import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/features/seo/services/seo-issue.service", () => ({
  listIssuesForJob: vi.fn(),
  updateIssueStatus: vi.fn(),
}));
vi.mock("@/features/seo/services/website-analysis.service", () => ({
  getWebsiteAnalysisJobById: vi.fn(),
}));

import { requireUser } from "@/lib/auth";
import { listIssuesForJob, updateIssueStatus } from "@/features/seo/services/seo-issue.service";
import { getWebsiteAnalysisJobById } from "@/features/seo/services/website-analysis.service";
import { listIssuesForJobAction, updateIssueStatusAction } from "@/features/seo/actions/seo-issue.actions";

const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedListIssuesForJob = listIssuesForJob as unknown as ReturnType<typeof vi.fn>;
const mockedUpdateIssueStatus = updateIssueStatus as unknown as ReturnType<typeof vi.fn>;
const mockedGetWebsiteAnalysisJobById = getWebsiteAnalysisJobById as unknown as ReturnType<typeof vi.fn>;

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";
const MANAGER = { id: "user-1", role: "MANAGER", companyId: COMPANY_A };
const EMPLOYEE = { id: "user-2", role: "EMPLOYEE", companyId: COMPANY_A };

function makeJob(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: "job-1", companyId: COMPANY_A, ...overrides };
}

describe("listIssuesForJobAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    mockedGetWebsiteAnalysisJobById.mockResolvedValue(makeJob());
    mockedListIssuesForJob.mockResolvedValue([{ id: "issue-1" }]);
  });

  it("1. succeeds for a plain EMPLOYEE (no role gate — self-service)", async () => {
    const result = await listIssuesForJobAction("job-1");
    expect(result.success).toBe(true);
  });

  it("2. rejects when the job does not exist, without listing issues", async () => {
    mockedGetWebsiteAnalysisJobById.mockResolvedValue(null);
    const result = await listIssuesForJobAction("job-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Website analysis job not found.");
    expect(mockedListIssuesForJob).not.toHaveBeenCalled();
  });

  it("3. rejects when the job belongs to a different company, without listing issues", async () => {
    mockedGetWebsiteAnalysisJobById.mockResolvedValue(makeJob({ companyId: COMPANY_B }));
    const result = await listIssuesForJobAction("job-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Website analysis job not found.");
    expect(mockedListIssuesForJob).not.toHaveBeenCalled();
  });

  it("4. looks up the job by the exact jobId", async () => {
    await listIssuesForJobAction("job-1");
    expect(mockedGetWebsiteAnalysisJobById).toHaveBeenCalledWith("job-1");
  });

  it("5. calls listIssuesForJob with the exact jobId once tenancy is confirmed", async () => {
    await listIssuesForJobAction("job-1");
    expect(mockedListIssuesForJob).toHaveBeenCalledWith("job-1");
  });

  it("6. returns exactly the issues resolved by the service, unmodified", async () => {
    const issues = [{ id: "issue-1" }, { id: "issue-2" }];
    mockedListIssuesForJob.mockResolvedValue(issues);
    const result = await listIssuesForJobAction("job-1");
    expect(result).toEqual({ success: true, data: issues });
  });

  it("7. returns an empty list as-is when the service resolves no issues", async () => {
    mockedListIssuesForJob.mockResolvedValue([]);
    const result = await listIssuesForJobAction("job-1");
    expect(result).toEqual({ success: true, data: [] });
  });
});

describe("updateIssueStatusAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedGetWebsiteAnalysisJobById.mockResolvedValue(makeJob());
    mockedUpdateIssueStatus.mockResolvedValue(true);
  });

  it("1. denies an EMPLOYEE without checking the job or updating the issue", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await updateIssueStatusAction("issue-1", "job-1", "OPEN");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to update this issue.");
    expect(mockedGetWebsiteAnalysisJobById).not.toHaveBeenCalled();
    expect(mockedUpdateIssueStatus).not.toHaveBeenCalled();
  });

  it("2. rejects when the job does not exist, without updating the issue", async () => {
    mockedGetWebsiteAnalysisJobById.mockResolvedValue(null);
    const result = await updateIssueStatusAction("issue-1", "job-1", "OPEN");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Website analysis job not found.");
    expect(mockedUpdateIssueStatus).not.toHaveBeenCalled();
  });

  it("3. rejects when the job belongs to a different company, without updating the issue", async () => {
    mockedGetWebsiteAnalysisJobById.mockResolvedValue(makeJob({ companyId: COMPANY_B }));
    const result = await updateIssueStatusAction("issue-1", "job-1", "OPEN");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Website analysis job not found.");
    expect(mockedUpdateIssueStatus).not.toHaveBeenCalled();
  });

  it("4. looks up the job by the exact jobId", async () => {
    await updateIssueStatusAction("issue-1", "job-1", "RESOLVED");
    expect(mockedGetWebsiteAnalysisJobById).toHaveBeenCalledWith("job-1");
  });

  it("5. calls updateIssueStatus with the exact issueId/jobId/status", async () => {
    await updateIssueStatusAction("issue-1", "job-1", "RESOLVED");
    expect(mockedUpdateIssueStatus).toHaveBeenCalledWith("issue-1", "job-1", "RESOLVED");
  });

  it("6. [CRITICAL] rejects with the exact message when the service reports the issue was not updated (updated: false), even though the job/authorization checks passed", async () => {
    mockedUpdateIssueStatus.mockResolvedValue(false);
    const result = await updateIssueStatusAction("issue-1", "job-1", "RESOLVED");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Issue not found.");
  });

  it("7. returns the exact issue id on success", async () => {
    const result = await updateIssueStatusAction("issue-1", "job-1", "RESOLVED");
    expect(result).toEqual({ success: true, data: { id: "issue-1" } });
  });

  it("8. rejected requests (bad role) never call the job lookup or the status update", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    await updateIssueStatusAction("issue-1", "job-1", "IGNORED");
    expect(mockedGetWebsiteAnalysisJobById).not.toHaveBeenCalled();
    expect(mockedUpdateIssueStatus).not.toHaveBeenCalled();
  });
});
