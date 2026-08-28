import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/jobs/ai-generation-job-table", () => ({ getAiGenerationJob: vi.fn(), cancelAiGenerationJob: vi.fn() }));

import { requireUser } from "@/lib/auth";
import { cancelAiGenerationJob, getAiGenerationJob } from "@/lib/jobs/ai-generation-job-table";
import { cancelAiGenerationJobAction, getAiGenerationJobAction } from "@/features/ai-workspace/actions/ai-generation-job.actions";

const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedGetAiGenerationJob = getAiGenerationJob as unknown as ReturnType<typeof vi.fn>;
const mockedCancelAiGenerationJob = cancelAiGenerationJob as unknown as ReturnType<typeof vi.fn>;

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";

const EMPLOYEE = { id: "user-1", role: "EMPLOYEE", companyId: COMPANY_A };

function makeJob(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "job-1",
    companyId: COMPANY_A,
    taskType: "CONTENT_BRIEF",
    status: "RUNNING",
    progress: 40,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequireUser.mockResolvedValue(EMPLOYEE);
  mockedGetAiGenerationJob.mockResolvedValue(makeJob());
});

describe("getAiGenerationJobAction", () => {
  it("1. queries by the given id", async () => {
    await getAiGenerationJobAction("job-1");
    expect(mockedGetAiGenerationJob).toHaveBeenCalledWith("job-1");
  });

  it("2. returns 'Generation job not found.' when the job does not exist", async () => {
    mockedGetAiGenerationJob.mockResolvedValue(null);
    const result = await getAiGenerationJobAction("missing");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Generation job not found.");
  });

  it("3. returns 'Generation job not found.' for a job belonging to a different company (tenant isolation) — never leaks that company's data", async () => {
    mockedGetAiGenerationJob.mockResolvedValue(makeJob({ companyId: COMPANY_B }));
    const result = await getAiGenerationJobAction("job-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Generation job not found.");
  });

  it("4. returns the job when it belongs to the actor's own company", async () => {
    const job = makeJob({ id: "job-1", companyId: COMPANY_A, progress: 75 });
    mockedGetAiGenerationJob.mockResolvedValue(job);
    const result = await getAiGenerationJobAction("job-1");
    expect(result).toEqual({ success: true, data: job });
  });

  it("5. has no role gate — any authenticated actor may poll their own company's job (matches the production implementation, which performs no Permissions check)", async () => {
    mockedRequireUser.mockResolvedValue({ id: "user-2", role: "EMPLOYEE", companyId: COMPANY_A });
    const result = await getAiGenerationJobAction("job-1");
    expect(result.success).toBe(true);
  });
});

/** Phase 30 Stage 10 */
describe("cancelAiGenerationJobAction", () => {
  beforeEach(() => {
    mockedCancelAiGenerationJob.mockResolvedValue({ count: 1 });
  });

  it("1. delegates to cancelAiGenerationJob scoped to the actor's own company, not a company id from the caller's input", async () => {
    await cancelAiGenerationJobAction("job-1");
    expect(mockedCancelAiGenerationJob).toHaveBeenCalledWith("job-1", COMPANY_A);
  });

  it("2. succeeds when a PENDING/RUNNING job was actually cancelled", async () => {
    const result = await cancelAiGenerationJobAction("job-1");
    expect(result).toEqual({ success: true, data: { cancelled: true } });
  });

  it("3. returns a specific error, not a thrown exception, when nothing matched (already finished, already cancelled, or belongs to another company)", async () => {
    mockedCancelAiGenerationJob.mockResolvedValue({ count: 0 });
    const result = await cancelAiGenerationJobAction("job-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("This generation could not be cancelled — it may have already finished.");
  });

  it("4. has no role gate — any authenticated actor may cancel their own company's job, matching getAiGenerationJobAction's permission shape", async () => {
    mockedRequireUser.mockResolvedValue({ id: "user-2", role: "EMPLOYEE", companyId: COMPANY_A });
    const result = await cancelAiGenerationJobAction("job-1");
    expect(result.success).toBe(true);
  });
});
