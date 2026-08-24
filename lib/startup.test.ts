import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: { publishingJob: { updateMany: vi.fn() } },
}));

import { prisma } from "@/lib/prisma";
import { reapStalePublishingJobs } from "@/lib/startup";

const mockedUpdateMany = (prisma as unknown as { publishingJob: { updateMany: ReturnType<typeof vi.fn> } }).publishingJob
  .updateMany;

describe("reapStalePublishingJobs", () => {
  beforeEach(() => {
    mockedUpdateMany.mockReset();
    mockedUpdateMany.mockResolvedValue({ count: 0 });
  });

  it("targets RUNNING jobs and PENDING jobs older than the grace period, never fresh PENDING jobs", async () => {
    await reapStalePublishingJobs();

    expect(mockedUpdateMany).toHaveBeenCalledTimes(1);
    const [args] = mockedUpdateMany.mock.calls[0];
    const or = args.where.OR;
    expect(or).toEqual(
      expect.arrayContaining([
        { status: "RUNNING" },
        expect.objectContaining({ status: "PENDING", createdAt: { lt: expect.any(Date) } }),
      ])
    );
  });

  it("uses the same 5-minute grace period as reapStaleAiGenerationJobs — no new configuration introduced", async () => {
    const before = Date.now();
    await reapStalePublishingJobs();
    const after = Date.now();

    const [args] = mockedUpdateMany.mock.calls[0];
    const pendingClause = args.where.OR.find((clause: { status: string }) => clause.status === "PENDING");
    const cutoff = pendingClause.createdAt.lt.getTime();

    const FIVE_MINUTES_MS = 5 * 60 * 1000;
    expect(before - cutoff).toBeGreaterThanOrEqual(FIVE_MINUTES_MS - 5);
    expect(after - cutoff).toBeLessThanOrEqual(FIVE_MINUTES_MS + 5000);
  });

  it("classifies every reaped job as FAILED / AMBIGUOUS_RESPONSE — never NETWORK_TIMEOUT or any other type", async () => {
    await reapStalePublishingJobs();

    const [args] = mockedUpdateMany.mock.calls[0];
    expect(args.data.status).toBe("FAILED");
    expect(args.data.errorType).toBe("AMBIGUOUS_RESPONSE");
    expect(args.data.errorMessage).toMatch(/restarted|interrupted/i);
    expect(args.data.errorMessage).toMatch(/could not be confirmed/i);
  });

  it("never touches Content, credentials, or PublishingAttempt/ContentPublication — only PublishingJob's own status fields", async () => {
    await reapStalePublishingJobs();

    const [args] = mockedUpdateMany.mock.calls[0];
    const dataKeys = Object.keys(args.data);
    expect(dataKeys.sort()).toEqual(["errorMessage", "errorType", "status"]);
  });

  it("returns the count of reaped jobs", async () => {
    mockedUpdateMany.mockResolvedValueOnce({ count: 3 });
    const count = await reapStalePublishingJobs();
    expect(count).toBe(3);
  });
});
