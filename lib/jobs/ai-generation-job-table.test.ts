import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiGenerationJob: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  cancelAiGenerationJob,
  getAiGenerationJob,
  markAiGenerationJobFailed,
  markAiGenerationJobSucceeded,
  updateAiGenerationJobPartialText,
} from "@/lib/jobs/ai-generation-job-table";

const mockUpdateMany = vi.mocked(prisma.aiGenerationJob.updateMany);
const mockFindUnique = vi.mocked(prisma.aiGenerationJob.findUnique);

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateMany.mockResolvedValue({ count: 1 } as never);
  mockFindUnique.mockResolvedValue({ id: "job-1" } as never);
});

/**
 * Phase 30 Stage 10 live-verification finding — a malformed (non-UUID)
 * jobId, now reachable via the refresh-recovery feature's user-editable
 * ?jobId= URL param, must never reach Prisma's @db.Uuid column: it throws a
 * raw, unhandled type error instead of returning null/zero rows. Live
 * browser testing caught this; these tests pin the fix down.
 */
describe("getAiGenerationJob — malformed id guard", () => {
  it("returns null for a non-UUID id without ever querying prisma", async () => {
    const result = await getAiGenerationJob("not-a-real-job-id");
    expect(result).toBeNull();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("still queries prisma normally for a well-formed UUID", async () => {
    await getAiGenerationJob("01a04aaf-a99b-73d0-8ee1-de5606937ab0");
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { id: "01a04aaf-a99b-73d0-8ee1-de5606937ab0" } });
  });
});

describe("cancelAiGenerationJob — malformed id guard", () => {
  it("returns a zero count for a non-UUID id without ever querying prisma", async () => {
    const result = await cancelAiGenerationJob("not-a-real-job-id", "company-a");
    expect(result).toEqual({ count: 0 });
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });
});

/**
 * Phase 30 Stage 10 — locks in the soft-cancel guard: markAiGenerationJobSucceeded/Failed
 * and updateAiGenerationJobPartialText must only ever transition a job that is
 * currently RUNNING, so a late-arriving result from a provider call that
 * can't actually be aborted can never overwrite a job the user already
 * cancelled. If a future change swaps these back to an unconditional
 * update(), these tests fail.
 */
describe("cancelAiGenerationJob", () => {
  const JOB_ID = "01a04aaf-a99b-73d0-8ee1-de5606937ab0";

  it("scopes the update to the owning company and to PENDING/RUNNING jobs only", async () => {
    await cancelAiGenerationJob(JOB_ID, "company-a");

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: JOB_ID, companyId: "company-a", status: { in: ["PENDING", "RUNNING"] } },
      data: { status: "CANCELLED" },
    });
  });

  it("reports zero rows updated (via the returned count) when the job is already terminal or owned by another company — never throws", async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 } as never);

    const result = await cancelAiGenerationJob(JOB_ID, "company-a");

    expect(result.count).toBe(0);
  });
});

describe("markAiGenerationJobSucceeded — soft-cancel guard", () => {
  it("only updates a job whose status is currently RUNNING", async () => {
    await markAiGenerationJobSucceeded("job-1", { title: "done" });

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "RUNNING" },
      data: { status: "SUCCEEDED", progress: 100, resultJson: { title: "done" } },
    });
  });

  it("is a no-op (zero rows matched) against a job that was already cancelled", async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 } as never);

    const result = await markAiGenerationJobSucceeded("job-1", { title: "done" });

    expect(result.count).toBe(0);
  });
});

describe("markAiGenerationJobFailed — soft-cancel guard", () => {
  it("only updates a job whose status is currently RUNNING", async () => {
    await markAiGenerationJobFailed("job-1", "Provider error", "UNKNOWN");

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "RUNNING" },
      data: { status: "FAILED", errorMessage: "Provider error", errorType: "UNKNOWN" },
    });
  });
});

describe("updateAiGenerationJobPartialText — soft-cancel guard", () => {
  it("only writes partial text to a job whose status is currently RUNNING", async () => {
    await updateAiGenerationJobPartialText("job-1", "partial text", 42);

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "RUNNING" },
      data: { partialResultText: "partial text", progress: 42 },
    });
  });

  it("omits progress from the write when not provided, same as before this stage", async () => {
    await updateAiGenerationJobPartialText("job-1", null);

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "RUNNING" },
      data: { partialResultText: null },
    });
  });
});
