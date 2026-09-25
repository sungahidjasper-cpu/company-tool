/**
 * Classification of database failures that a READ may safely retry instead of
 * reporting as a real failure.
 *
 * Motivation — a live-verification finding during AI job polling:
 *
 *     Invalid `prisma.aiGenerationJob.findUnique()` invocation
 *     Database error. Code: 08P01
 *     bind message supplies 3 parameters, but prepared statement "" requires 0
 *
 * `findUnique({ where: { id } })` compiles to exactly three bind parameters
 * (`WHERE id = $1 ... LIMIT $2 OFFSET $3` — verified against the emitted SQL),
 * so the application's side of that exchange is correct and constant. The
 * mismatch is that the server's UNNAMED prepared statement ("") had zero
 * parameters by the time Bind arrived — the parsed statement was lost or
 * replaced between Parse and Bind. That is a connection/protocol-level fault
 * (a pooler or proxy multiplexing backends, or two operations interleaving on
 * one physical connection), never something a caller can cause by passing a
 * well-formed scalar id. `lib/prisma.ts` already documents a sibling fault
 * from the same layer (P1017, which forced this app's non-default `max: 5`).
 *
 * Deliberately conservative, following this repository's existing
 * classification precedent in `features/publishing/services/publishing-errors.ts`:
 * only failures where the query provably never produced an answer are
 * retryable. Anything ambiguous, and every error about the DATA itself
 * (constraint violations, type errors, missing relations), is excluded so it
 * still surfaces as a real error.
 *
 * The name says "polling" on purpose: this is scoped to idempotent reads.
 * A read costs nothing to repeat, so "we never got an answer" always means
 * "ask again." Do NOT reuse this to decide whether a WRITE may be retried —
 * a write that failed after reaching the server may already have applied, so
 * it needs the stricter ambiguity analysis `classifyNetworkFailure` performs.
 */

/**
 * Postgres SQLSTATEs that mean the connection or wire protocol broke, not that
 * the statement was rejected on its merits.
 *
 * - 08xxx — the "connection exception" class.
 * - 08P01 — protocol violation; the exact code observed above.
 * - 34000 — invalid cursor/portal ("portal does not exist"), the sibling
 *   symptom of the same lost-session-state fault.
 * - 57P01/02/03 — the server terminated or is not yet accepting connections.
 *
 * Intentionally NOT included: 08007 (transaction resolution unknown) is
 * genuinely ambiguous, and 40001/40P01 (serialization failure, deadlock) are
 * contention outcomes rather than connection faults — neither has been
 * observed here, and both would widen this set beyond what evidence supports.
 */
const TRANSIENT_POSTGRES_CODES: ReadonlySet<string> = new Set([
  "08P01",
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "34000",
  "57P01",
  "57P02",
  "57P03",
]);

/** Prisma's own connection-level codes — the server was unreachable, so no query ran. */
const TRANSIENT_PRISMA_CODES: ReadonlySet<string> = new Set([
  "P1001", // can't reach database server
  "P1002", // database server reached but timed out
  "P1008", // operation timed out
  "P1017", // server has closed the connection
]);

/**
 * Node socket errnos. Prisma 7's driver-adapter path surfaces these as the
 * `code` of a PrismaClientKnownRequestError verbatim (confirmed by observing a
 * real failure against a dead port, which produced `code: "ECONNREFUSED"`),
 * so they must be matched as-is rather than assumed to be Prisma P-codes.
 */
const TRANSIENT_SOCKET_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

/**
 * Collects every code an error carries. On Prisma 7 with the `pg` driver
 * adapter the underlying Postgres SQLSTATE is NOT the top-level `code` — that
 * is the generic `P2010`, with the real code nested at
 * `meta.driverAdapterError.cause.originalCode` (verified against real errors
 * from this exact stack). Both positions are read, plus a plain `cause` chain,
 * because a single missed position would silently downgrade this whole guard.
 */
function collectErrorCodes(error: unknown): string[] {
  if (typeof error !== "object" || error === null) return [];
  const candidate = error as Record<string, unknown>;
  const codes: string[] = [];

  if (typeof candidate.code === "string") codes.push(candidate.code);

  const meta = candidate.meta as Record<string, unknown> | undefined;
  const adapterCause = (meta?.driverAdapterError as Record<string, unknown> | undefined)?.cause as
    | Record<string, unknown>
    | undefined;
  if (typeof adapterCause?.originalCode === "string") codes.push(adapterCause.originalCode);

  const cause = candidate.cause as Record<string, unknown> | undefined;
  if (typeof cause?.code === "string") codes.push(cause.code);
  if (typeof cause?.originalCode === "string") codes.push(cause.originalCode);

  return codes;
}

export function isTransientPollingDatabaseError(error: unknown): boolean {
  const codes = collectErrorCodes(error);
  if (
    codes.some(
      (code) => TRANSIENT_POSTGRES_CODES.has(code) || TRANSIENT_PRISMA_CODES.has(code) || TRANSIENT_SOCKET_CODES.has(code)
    )
  ) {
    return true;
  }

  /*
   * Message fallback. The 08P01 fault could not be reproduced on demand, so
   * the precise nesting position of its SQLSTATE on this stack is not directly
   * confirmed — only the rendered message ("Database error. Code: 08P01") is.
   * This reads the code back out of that rendering and still requires it to be
   * in the allowlist above, so it can never widen what counts as transient; it
   * only stops a structural miss from silently defeating the guard.
   */
  const message = typeof (error as { message?: unknown } | null)?.message === "string" ? (error as { message: string }).message : "";
  if (!message) return false;
  const rendered = /Code:\s*`?([0-9A-Za-z]{5})`?/.exec(message);
  return rendered !== null && TRANSIENT_POSTGRES_CODES.has(rendered[1]);
}

/**
 * A short, non-sensitive description for server logs. Deliberately returns
 * only the error's codes and its first message line — an AiGenerationJob's
 * `inputJson`/`resultJson` (prompts, Content bodies, Brand Profile text) must
 * never reach a log line, and none of them appear in these fields.
 */
export function describeDatabaseErrorForLog(error: unknown): string {
  const codes = collectErrorCodes(error);
  const message = typeof (error as { message?: unknown } | null)?.message === "string" ? (error as { message: string }).message : String(error);
  return `codes=[${codes.join(", ")}] ${message.split("\n")[0].slice(0, 200)}`;
}
