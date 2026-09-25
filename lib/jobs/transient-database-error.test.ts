import { describe, expect, it } from "vitest";

import { describeDatabaseErrorForLog, isTransientPollingDatabaseError } from "@/lib/jobs/transient-database-error";

/**
 * The error shapes below are not invented — they mirror errors captured from
 * this exact stack (Prisma 7 + the `pg` driver adapter) during investigation:
 * an underlying Postgres failure arrives as a PrismaClientKnownRequestError
 * whose top-level `code` is the generic "P2010", with the real SQLSTATE nested
 * at `meta.driverAdapterError.cause.originalCode`; a connection failure
 * arrives with a Node errno ("ECONNREFUSED") as the top-level `code`.
 */
function prismaAdapterError(originalCode: string, originalMessage: string, rendered?: string) {
  return Object.assign(new Error(rendered ?? `Invalid \`prisma.aiGenerationJob.findUnique()\` invocation:\nDatabase error. Code: ${originalCode}. Message: ${originalMessage}`), {
    name: "PrismaClientKnownRequestError",
    code: "P2010",
    meta: { driverAdapterError: { name: "DriverAdapterError", cause: { originalCode, originalMessage } } },
  });
}

function prismaTopLevelError(code: string, message: string) {
  return Object.assign(new Error(message), { name: "PrismaClientKnownRequestError", code, meta: { modelName: "AiGenerationJob" } });
}

describe("isTransientPollingDatabaseError — the observed fault", () => {
  it("1. classifies the captured 08P01 protocol violation as transient", () => {
    const error = prismaAdapterError("08P01", 'bind message supplies 3 parameters, but prepared statement "" requires 0');
    expect(isTransientPollingDatabaseError(error)).toBe(true);
  });

  it("2. classifies its sibling 34000 (portal does not exist) as transient", () => {
    expect(isTransientPollingDatabaseError(prismaAdapterError("34000", "portal does not exist"))).toBe(true);
  });

  it("3. still classifies 08P01 when only the rendered message carries the code — the nesting position could not be confirmed against a live reproduction, so a structural miss must not defeat the guard", () => {
    const error = Object.assign(new Error("Invalid `prisma.aiGenerationJob.findUnique()` invocation:\nDatabase error. Code: 08P01"), {
      name: "PrismaClientKnownRequestError",
      code: "P2010",
      meta: {},
    });
    expect(isTransientPollingDatabaseError(error)).toBe(true);
  });
});

describe("isTransientPollingDatabaseError — connection-level faults", () => {
  it("4. the whole 08xxx connection-exception class is transient", () => {
    for (const code of ["08000", "08001", "08003", "08004", "08006"]) {
      expect(isTransientPollingDatabaseError(prismaAdapterError(code, "connection exception"))).toBe(true);
    }
  });

  it("5. server shutdown/startup codes are transient", () => {
    for (const code of ["57P01", "57P02", "57P03"]) {
      expect(isTransientPollingDatabaseError(prismaAdapterError(code, "server terminated"))).toBe(true);
    }
  });

  it("6. Prisma's own connection codes are transient", () => {
    for (const code of ["P1001", "P1002", "P1008", "P1017"]) {
      expect(isTransientPollingDatabaseError(prismaTopLevelError(code, "connection problem"))).toBe(true);
    }
  });

  it("7. Node socket errnos surfaced as the top-level code are transient — verified against a real failure to a dead port, which produced code 'ECONNREFUSED', NOT a Prisma P-code", () => {
    expect(isTransientPollingDatabaseError(prismaTopLevelError("ECONNREFUSED", "connect ECONNREFUSED"))).toBe(true);
    expect(isTransientPollingDatabaseError(prismaTopLevelError("ECONNRESET", "socket hang up"))).toBe(true);
  });
});

describe("isTransientPollingDatabaseError — must NOT swallow real errors", () => {
  it("8. a missing table (42P01) is a real error, never retried", () => {
    expect(isTransientPollingDatabaseError(prismaAdapterError("42P01", 'relation "AiGenerationJob" does not exist'))).toBe(false);
  });

  it("9. an invalid value (22P02) is a real error, never retried", () => {
    expect(isTransientPollingDatabaseError(prismaAdapterError("22P02", "invalid input syntax for type uuid"))).toBe(false);
  });

  it("10. P2010 alone is NOT transient — the generic wrapper code must never stand in for the SQLSTATE it wraps", () => {
    expect(isTransientPollingDatabaseError(prismaTopLevelError("P2010", "Raw query failed"))).toBe(false);
  });

  it("11. constraint and record errors are real errors", () => {
    expect(isTransientPollingDatabaseError(prismaTopLevelError("P2002", "Unique constraint failed"))).toBe(false);
    expect(isTransientPollingDatabaseError(prismaTopLevelError("P2025", "Record to update not found"))).toBe(false);
  });

  it("12. ambiguous or contention codes are deliberately excluded, matching this repo's conservative classification precedent", () => {
    expect(isTransientPollingDatabaseError(prismaAdapterError("08007", "transaction resolution unknown"))).toBe(false);
    expect(isTransientPollingDatabaseError(prismaAdapterError("40001", "serialization failure"))).toBe(false);
    expect(isTransientPollingDatabaseError(prismaAdapterError("40P01", "deadlock detected"))).toBe(false);
  });

  it("13. an ordinary programming error is never transient", () => {
    expect(isTransientPollingDatabaseError(new TypeError("x is not a function"))).toBe(false);
  });

  it("14. non-error inputs are handled without throwing", () => {
    for (const value of [null, undefined, "08P01", 42, {}, []]) {
      expect(isTransientPollingDatabaseError(value)).toBe(false);
    }
  });

  it("15. the message fallback cannot widen the allowlist — a five-character code in a message that is not allowlisted stays a real error", () => {
    const error = Object.assign(new Error("Database error. Code: 42P01"), { name: "PrismaClientKnownRequestError", code: "P2010", meta: {} });
    expect(isTransientPollingDatabaseError(error)).toBe(false);
  });
});

describe("describeDatabaseErrorForLog — diagnostics without leaking content", () => {
  it("16. reports the codes and the first message line", () => {
    const described = describeDatabaseErrorForLog(prismaAdapterError("08P01", "bind message supplies 3 parameters"));
    expect(described).toContain("08P01");
    expect(described).toContain("P2010");
  });

  it("17. never includes a job's payload — only the error's own codes and message reach the log", () => {
    const error = prismaAdapterError("08P01", "bind message supplies 3 parameters");
    (error as unknown as Record<string, unknown>).inputJson = { prompt: "SECRET PROMPT TEXT", body: "SECRET CONTENT BODY" };
    const described = describeDatabaseErrorForLog(error);
    expect(described).not.toContain("SECRET PROMPT TEXT");
    expect(described).not.toContain("SECRET CONTENT BODY");
  });

  it("18. truncates a long message rather than dumping it whole", () => {
    const described = describeDatabaseErrorForLog(new Error("x".repeat(5000)));
    expect(described.length).toBeLessThan(300);
  });
});
