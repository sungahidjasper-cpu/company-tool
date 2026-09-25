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

/**
 * Polling reliability — a POLL that fails is not a JOB that failed.
 *
 * A poll is a pure read of a job the client neither owns nor drives. When the
 * read itself breaks at the connection/protocol layer the generation is still
 * running server-side, so the only correct answer is "no verdict yet, ask
 * again" — never "generation failed". Before this guard the exception escaped
 * the server action entirely and surfaced as a runtime error.
 */
describe("getAiGenerationJobAction — transient database failures", () => {
  function transient08P01() {
    return Object.assign(new Error('Invalid `prisma.aiGenerationJob.findUnique()` invocation:\nDatabase error. Code: 08P01. Message: bind message supplies 3 parameters, but prepared statement "" requires 0'), {
      name: "PrismaClientKnownRequestError",
      code: "P2010",
      meta: { driverAdapterError: { name: "DriverAdapterError", cause: { originalCode: "08P01" } } },
    });
  }

  it("6. TRANSIENT 08P01 — does not throw, and reports no verdict rather than a failure, so the caller keeps polling", async () => {
    mockedGetAiGenerationJob.mockRejectedValue(transient08P01());
    const result = await getAiGenerationJobAction("job-1");
    expect(result).toEqual({ success: true, data: null });
  });

  it("7. TRANSIENT 08P01 — never reported as 'not found', which would stop polling and blame a job that is still running", async () => {
    mockedGetAiGenerationJob.mockRejectedValue(transient08P01());
    const result = await getAiGenerationJobAction("job-1");
    expect(result.success).toBe(true);
  });

  it("8. RECOVERY — a tick that fails transiently is followed by a normal successful tick", async () => {
    const job = makeJob({ status: "SUCCEEDED" });
    mockedGetAiGenerationJob.mockRejectedValueOnce(transient08P01()).mockResolvedValue(job);

    const first = await getAiGenerationJobAction("job-1");
    const second = await getAiGenerationJobAction("job-1");

    expect(first).toEqual({ success: true, data: null });
    expect(second).toEqual({ success: true, data: job });
  });

  it("9. UNEXPECTED database error — surfaced as a real error, never disguised as a retryable poll", async () => {
    mockedGetAiGenerationJob.mockRejectedValue(
      Object.assign(new Error("Database error. Code: 42P01"), {
        name: "PrismaClientKnownRequestError",
        code: "P2010",
        meta: { driverAdapterError: { cause: { originalCode: "42P01" } } },
      })
    );
    const result = await getAiGenerationJobAction("job-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Could not check the generation status. Please try again.");
  });

  it("10. UNEXPECTED programming error — still handled as an error result, and logged so it stays diagnosable", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedGetAiGenerationJob.mockRejectedValue(new TypeError("x is not a function"));

    const result = await getAiGenerationJobAction("job-1");

    expect(result.success).toBe(false);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("11. a transient failure is logged too — diagnostics are never silently swallowed", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockedGetAiGenerationJob.mockRejectedValue(transient08P01());

    await getAiGenerationJobAction("job-1");

    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining("08P01"));
    consoleWarn.mockRestore();
  });

  it("12. tenant isolation is unaffected — another company's job still reads back as not found, even with the new error handling in place", async () => {
    mockedGetAiGenerationJob.mockResolvedValue(makeJob({ companyId: COMPANY_B }));
    const result = await getAiGenerationJobAction("job-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Generation job not found.");
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
