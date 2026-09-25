import { describe, expect, it } from "vitest";

import { classifyPollTick } from "@/features/ai-workspace/hooks/use-ai-generation-lifecycle";

/**
 * This repository has no React rendering test setup (vitest runs
 * `environment: "node"`, with no jsdom/testing-library installed), so the
 * lifecycle's reliability rule is tested through the pure function the poll
 * interval delegates to — the same approach the AI Workspace pickers already
 * use for their own logic. The interval's timer mechanics themselves are
 * covered by live browser verification.
 *
 * The rule under test: a POLL that fails must never be mistaken for a JOB
 * that failed.
 */
const JOB = { id: "job-1", companyId: "company-a", status: "RUNNING", errorType: null, errorMessage: null, resultJson: null };

describe("classifyPollTick — successful polls", () => {
  it("1. a running job is handed back for inspection, so the normal lifecycle continues", () => {
    const tick = classifyPollTick({ success: true, data: JOB } as never);
    expect(tick.kind).toBe("job");
    if (tick.kind === "job") expect(tick.job.status).toBe("RUNNING");
  });

  it("2. a SUCCEEDED job is handed back for inspection, not treated as a retry", () => {
    const tick = classifyPollTick({ success: true, data: { ...JOB, status: "SUCCEEDED" } } as never);
    expect(tick.kind).toBe("job");
  });
});

describe("classifyPollTick — genuine job failure still fails", () => {
  it("3. a FAILED job is handed back for inspection so the existing failure handling runs unchanged", () => {
    const tick = classifyPollTick({ success: true, data: { ...JOB, status: "FAILED", errorMessage: "Provider unavailable." } } as never);
    expect(tick.kind).toBe("job");
    if (tick.kind === "job") expect(tick.job.status).toBe("FAILED");
  });

  it("4. a definite negative answer from the action (missing job, or another company's) is reported as a failure and stops polling", () => {
    const tick = classifyPollTick({ success: false, message: "Generation job not found." });
    expect(tick).toEqual({ kind: "failed", message: "Generation job not found." });
  });
});

describe("classifyPollTick — transient polling failures must retry, never fail", () => {
  it("5. a THROWN poll request (represented as null) retries — the job is untouched and still running", () => {
    expect(classifyPollTick(null)).toEqual({ kind: "retry" });
  });

  it("6. 'no verdict yet' (data: null — how the action reports a transient database read) retries, never fails", () => {
    expect(classifyPollTick({ success: true, data: null } as never)).toEqual({ kind: "retry" });
  });

  it("7. a retry is NOT a failure — it must not carry a message the caller would show as 'generation failed'", () => {
    const tick = classifyPollTick(null);
    expect(tick.kind).toBe("retry");
    expect(tick).not.toHaveProperty("message");
  });

  it("8. RECOVERY — a transient tick followed by a successful tick yields a normal job verdict", () => {
    const sequence = [null, { success: true, data: null }, { success: true, data: { ...JOB, status: "SUCCEEDED" } }];
    const kinds = sequence.map((poll) => classifyPollTick(poll as never).kind);
    expect(kinds).toEqual(["retry", "retry", "job"]);
  });

  it("9. a transient tick is indistinguishable from any other retry — repeated transients never escalate themselves into a failure (the caller's MAX_POLL_MS ceiling is what bounds them)", () => {
    const kinds = Array.from({ length: 25 }, () => classifyPollTick(null).kind);
    expect(new Set(kinds)).toEqual(new Set(["retry"]));
  });
});
