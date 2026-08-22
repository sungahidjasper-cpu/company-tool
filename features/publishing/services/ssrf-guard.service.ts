import { promises as dns } from "node:dns";
import https from "node:https";

type NodeLookupFunction = NonNullable<https.RequestOptions["lookup"]>;

/**
 * Builds a `lookup` override for https.request that always resolves to the
 * one, already SSRF-validated IP — regardless of whether Node's connect
 * path calls it in single-address form or `{ all: true }` array form (the
 * Happy-Eyeballs / RFC 8305 path used by newer Node versions).
 */
function pinnedLookup(pinnedIp: string, pinnedFamily: 4 | 6): NodeLookupFunction {
  return ((hostname, options, callback) => {
    const wantsAll = typeof options === "object" && options !== null && "all" in options && Boolean((options as { all?: boolean }).all);
    if (wantsAll) {
      (callback as (err: null, addresses: { address: string; family: number }[]) => void)(null, [
        { address: pinnedIp, family: pinnedFamily },
      ]);
    } else {
      (callback as (err: null, address: string, family: number) => void)(null, pinnedIp, pinnedFamily);
    }
  }) as NodeLookupFunction;
}

/**
 * Phase 24 Stage 1 — SSRF protection for any outbound call to a
 * company-supplied destination baseUrl. Two functions:
 *  - assertSafePublicUrl: validates scheme + resolves DNS + rejects any
 *    private/internal/loopback/link-local address, returning the exact IP
 *    to connect to.
 *  - performSsrfGuardedRequest: performs the actual HTTPS request against
 *    that pinned IP (never a fresh DNS lookup at connect time — closing the
 *    DNS-rebinding gap), with redirects disabled and a bounded timeout.
 *
 * Every outbound call to a PublishingConnection.baseUrl — the initial
 * credential-validation request included — must go through both of these,
 * in that order, before any network I/O happens.
 */

export class UnsafePublishingUrlError extends Error {}

const REQUEST_TIMEOUT_MS = 15_000;

function isBlockedIpv4(ip: string): boolean {
  const octets = ip.split(".").map(Number);
  if (octets.length !== 4 || octets.some((o) => Number.isNaN(o))) return true; // malformed — fail closed
  const [a, b] = octets;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 127) return true; // 127.0.0.0/8 (loopback)
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local)
  if (a === 0) return true; // 0.0.0.0/8
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1") return true; // loopback
  if (normalized.startsWith("fe80:") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true; // fe80::/10 link-local
  if (/^f[cd][0-9a-f]{2}:/.test(normalized)) return true; // fc00::/7 unique local
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — re-check the embedded IPv4.
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]);
  return false;
}

function isBlockedIp(address: string, family: number): boolean {
  return family === 4 ? isBlockedIpv4(address) : isBlockedIpv6(address);
}

export type SafeUrlCheck = {
  hostname: string;
  port: number;
  pinnedIp: string;
  pinnedFamily: 4 | 6;
};

/**
 * Validates a company-supplied destination URL is safe to connect to, and
 * resolves it to one specific IP to pin the actual connection to. Throws
 * UnsafePublishingUrlError on any rejection — never returns a partial result.
 */
export async function assertSafePublicUrl(rawUrl: string): Promise<SafeUrlCheck> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafePublishingUrlError("The destination URL is not a valid URL.");
  }

  if (url.protocol !== "https:") {
    throw new UnsafePublishingUrlError("Only https:// destination URLs are allowed.");
  }

  const hostname = url.hostname;
  if (hostname.toLowerCase() === "localhost") {
    throw new UnsafePublishingUrlError("The destination URL may not point to localhost.");
  }

  let addresses: { address: string; family: number }[];
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new UnsafePublishingUrlError("The destination hostname could not be resolved.");
  }
  if (addresses.length === 0) {
    throw new UnsafePublishingUrlError("The destination hostname did not resolve to any address.");
  }

  for (const { address, family } of addresses) {
    if (isBlockedIp(address, family)) {
      throw new UnsafePublishingUrlError(
        "The destination URL resolves to a private, internal, or otherwise disallowed address."
      );
    }
  }

  const pinned = addresses[0];
  return {
    hostname,
    port: url.port ? Number(url.port) : 443,
    pinnedIp: pinned.address,
    pinnedFamily: pinned.family === 6 ? 6 : 4,
  };
}

export type GuardedRequestOptions = {
  method: "GET" | "POST" | "PUT";
  path: string;
  headers?: Record<string, string>;
  body?: string;
};

export type GuardedResponse = {
  statusCode: number;
  body: string;
};

/**
 * Performs the actual HTTPS request against the already-validated, pinned
 * IP from assertSafePublicUrl — never re-resolving the hostname at connect
 * time, which is what closes the DNS-rebinding window between validation
 * and use. TLS SNI and the Host header still use the original hostname (via
 * `servername`/the default Host derived from `host`), so certificate
 * validation and destination-side virtual-hosting both work correctly.
 * Redirects are never followed — a 3xx response is returned as-is for the
 * caller to treat as a hard failure.
 */
export function performSsrfGuardedRequest(check: SafeUrlCheck, options: GuardedRequestOptions): Promise<GuardedResponse> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: check.hostname,
        servername: check.hostname,
        port: check.port,
        path: options.path,
        method: options.method,
        headers: options.headers,
        timeout: REQUEST_TIMEOUT_MS,
        // Pin the connection to the already-validated IP instead of letting
        // Node re-resolve the hostname just before connecting. Node's
        // Happy-Eyeballs (RFC 8305) connect path calls this with
        // `{ all: true }` and expects an array back; the legacy single-
        // address call site expects (err, address, family) instead — handle
        // both so pinning works regardless of which path Node takes.
        lookup: pinnedLookup(check.pinnedIp, check.pinnedFamily),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") });
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error("Request to the destination timed out."));
    });
    req.on("error", (err) => reject(err));

    if (options.body) req.write(options.body);
    req.end();
  });
}
