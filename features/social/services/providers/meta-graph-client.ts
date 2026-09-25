import "server-only";

/**
 * Phase 10A — the one shared, low-level Graph API fetch helper.
 *
 * PURE EXTRACTION, NOT A REWRITE. This is exactly the `graphFetch` function
 * meta-facebook.provider.ts already had — moved here unchanged so
 * meta-facebook.publisher.ts (Phase 10A) can use the identical fetch/timeout/
 * error-shape discipline instead of a second, slightly-different copy. No
 * behavior here differs from what Phase 9B already verified against Meta's
 * documentation.
 */

/**
 * Pinned, and current: Meta's versioning guide names v26.0 as the current
 * Graph API version, and states each version "is guaranteed to operate for at
 * least two years". Pinning matters because an unpinned call silently changes
 * behaviour when Meta promotes a new default.
 */
export const GRAPH_VERSION = "v26.0";
export const GRAPH_REQUEST_TIMEOUT_MS = 10_000;

/**
 * `code`/`subcode`/`type`/`fbtraceId` are read straight from Meta's own
 * documented error-object shape (`error.code`, `error.error_subcode`,
 * `error.type`, `error.fbtrace_id`) — never guessed. All four are optional
 * because a non-JSON or network-level failure has none of them; callers that
 * want a human-readable reason must handle that case, same as before this
 * shape existed.
 *
 * `detail` is unchanged: the full stringified error object, for logs only.
 */
export type GraphResult =
  | { ok: true; body: unknown }
  | { ok: false; detail: string; code?: number; subcode?: number; type?: string; fbtraceId?: string };

/** Shared by every call below — one place that decides what counts as a usable Graph response. */
async function parseGraphResponse(response: Response): Promise<GraphResult> {
  const text = await response.text();

  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }

  if (!response.ok) {
    const errorObject = typeof body === "object" && body !== null && "error" in body ? (body as { error: unknown }).error : null;
    const errorMessage = errorObject !== null ? JSON.stringify(errorObject) : `HTTP ${response.status}`;
    const safeError = typeof errorObject === "object" && errorObject !== null ? (errorObject as Record<string, unknown>) : null;
    return {
      ok: false,
      detail: errorMessage,
      code: typeof safeError?.code === "number" ? safeError.code : undefined,
      subcode: typeof safeError?.error_subcode === "number" ? safeError.error_subcode : undefined,
      type: typeof safeError?.type === "string" ? safeError.type : undefined,
      fbtraceId: typeof safeError?.fbtrace_id === "string" ? safeError.fbtrace_id : undefined,
    };
  }
  if (body === null) return { ok: false, detail: "Response was not JSON." };
  return { ok: true, body };
}

export async function graphFetch(url: string): Promise<GraphResult> {
  try {
    const response = await fetch(url, {
      // A token exchange or publish call must never be served from a cache.
      cache: "no-store",
      signal: AbortSignal.timeout(GRAPH_REQUEST_TIMEOUT_MS),
    });
    return await parseGraphResponse(response);
  } catch (error) {
    /* Never interpolates the URL — it may hold the app secret or an access token. */
    return { ok: false, detail: error instanceof Error ? error.name : "Unknown fetch failure" };
  }
}

/**
 * The same call, but POST instead of GET — for endpoints that create
 * something (Meta documents feed-publish as `POST /{page-id}/feed`).
 *
 * Parameters still travel in the query string, same as every GET call in
 * this feature: Graph API accepts its parameters that way regardless of HTTP
 * verb, and using the one convention everywhere means there is no second,
 * unverified body-encoding assumption to get wrong.
 */
export async function graphPost(url: string): Promise<GraphResult> {
  try {
    const response = await fetch(url, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(GRAPH_REQUEST_TIMEOUT_MS),
    });
    return await parseGraphResponse(response);
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.name : "Unknown fetch failure" };
  }
}

/**
 * Stage 2 — a POST carrying an actual file, for endpoints that document a
 * binary `source` upload as their alternative to a public `url` (Meta's Page
 * Photos reference documents both). The body is a real `multipart/form-data`
 * request — `fetch` sets that Content-Type (with the correct boundary)
 * itself whenever it is given a `FormData` body, so it is never set by hand
 * here.
 */
export async function graphPostMultipart(url: string, form: FormData): Promise<GraphResult> {
  try {
    const response = await fetch(url, {
      method: "POST",
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(GRAPH_REQUEST_TIMEOUT_MS),
    });
    return await parseGraphResponse(response);
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.name : "Unknown fetch failure" };
  }
}
