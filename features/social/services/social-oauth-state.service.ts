import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { ProviderAuthorization, DiscoveredAccount } from "@/features/social/services/social-provider";
import {
  decryptCredentialPayload,
  encryptCredentialPayload,
} from "@/lib/crypto/publishing-credential-crypto";
import type { SocialPlatform } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

/**
 * Phase 9 — the OAuth `state` value, and the only thing the callback trusts.
 *
 * WHY THIS EXISTS AT ALL. An OAuth callback arrives as a plain browser GET
 * with whatever query string the browser felt like sending. If the callback
 * read a companyId or clientId from that query string, anyone could aim an
 * authorization at another company's client. So the callback reads NOTHING
 * from the query string except the state value and the provider's code: the
 * company, the client, the platform and the account being reconnected all
 * come from the row created here, before the person ever left the app.
 *
 * WHY ONLY A HASH IS STORED. The state is a bearer value — presenting it is
 * what proves a callback belongs to a flow this server started. Storing it
 * verbatim would mean a read of this table could forge a valid callback, so
 * only its SHA-256 is persisted, the same reasoning as never storing a raw
 * password. The raw value exists in exactly two places: the provider's
 * redirect URL, and the returning browser request.
 *
 * SINGLE USE. Redemption is one conditional UPDATE — unconsumed AND unexpired
 * — so two callbacks racing on the same state can never both win. A replayed
 * state matches nothing and is refused.
 *
 * THE STATE ITSELF IS NOT A SECRET. It is random and meaningless on its own;
 * every fact about the flow is looked up server-side by its hash. No app
 * secret and no authorization code is ever stored.
 *
 * ONE EXCEPTION, DELIBERATE AND SCOPED. A completed authorization waits on
 * this row for the few minutes between the callback and the moment a person
 * picks which Page to connect — encrypted, never readable, cleared as soon as
 * the flow ends. The reasoning is in "The page-selection handoff" below.
 */

/**
 * Ten minutes. Long enough for a person to read a provider's consent screen
 * and pick a page, short enough that an abandoned flow stops being usable
 * almost immediately.
 */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** 32 random bytes, base64url. Not a counter, not a timestamp, not derivable. */
const STATE_BYTES = 32;

export type OAuthFlowContext = {
  companyId: string;
  clientId: string;
  platform: SocialPlatform;
  /** Set only when reconnecting one specific existing account. */
  socialAccountId: string | null;
  startedByUserId: string | null;
};

export type ConsumeStateResult =
  | { ok: true; context: OAuthFlowContext }
  /**
   * One shape for every failure, and the caller shows one message. The reason
   * is for the server's own log and for tests — telling a browser whether a
   * state was unknown, expired or already used is free information about
   * other people's flows.
   */
  | { ok: false; reason: "MALFORMED" | "UNKNOWN" | "EXPIRED" | "ALREADY_USED" };

function hashState(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

/**
 * Starts a flow: records what it is FOR, and returns the random value to hand
 * the provider. The returned string is the only copy — it is not stored.
 */
export async function createOAuthState(context: OAuthFlowContext): Promise<string> {
  const state = randomBytes(STATE_BYTES).toString("base64url");

  await prisma.socialOAuthState.create({
    data: {
      stateHash: hashState(state),
      companyId: context.companyId,
      clientId: context.clientId,
      platform: context.platform,
      socialAccountId: context.socialAccountId,
      startedByUserId: context.startedByUserId,
      expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
    },
  });

  return state;
}

/**
 * Redeems a state exactly once and returns what the flow was for.
 *
 * Fails closed on everything: a value that isn't a plausible state, one this
 * server never issued, one past its expiry, and one already redeemed. There
 * is no path through this function that yields a context without a matching
 * unconsumed, unexpired row.
 */
export async function consumeOAuthState(rawState: string | null | undefined): Promise<ConsumeStateResult> {
  if (typeof rawState !== "string" || rawState.length < 16 || rawState.length > 512) {
    return { ok: false, reason: "MALFORMED" };
  }

  const stateHash = hashState(rawState);
  const now = new Date();

  /*
   * The conditional UPDATE is the actual guard, not this read — this read
   * only exists to name the failure for the log. Between the two, another
   * request could redeem the row; that is fine, the update then matches
   * nothing and this returns ALREADY_USED, which is the truth.
   */
  const existing = await prisma.socialOAuthState.findUnique({
    where: { stateHash },
    select: { consumedAt: true, expiresAt: true },
  });
  if (!existing) return { ok: false, reason: "UNKNOWN" };
  if (existing.consumedAt !== null) return { ok: false, reason: "ALREADY_USED" };
  if (existing.expiresAt <= now) return { ok: false, reason: "EXPIRED" };

  const claimed = await prisma.socialOAuthState.updateMany({
    where: { stateHash, consumedAt: null, expiresAt: { gt: now } },
    data: { consumedAt: now },
  });
  if (claimed.count !== 1) return { ok: false, reason: "ALREADY_USED" };

  const row = await prisma.socialOAuthState.findUnique({
    where: { stateHash },
    select: { companyId: true, clientId: true, platform: true, socialAccountId: true, startedByUserId: true },
  });
  if (!row) return { ok: false, reason: "UNKNOWN" };

  return {
    ok: true,
    context: {
      companyId: row.companyId,
      clientId: row.clientId,
      platform: row.platform,
      socialAccountId: row.socialAccountId,
      startedByUserId: row.startedByUserId,
    },
  };
}

/**
 * Constant-time comparison of two state values.
 *
 * Not used by `consumeOAuthState` — that looks a hash up by index, which
 * never compares secrets byte by byte. Exported for a provider that hands
 * back a state to compare directly, so the comparison is right if it happens.
 */
export function statesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Removes states that can no longer be redeemed. Housekeeping only — an
 * expired row is already refused, so this never affects whether a flow works.
 */
export async function purgeExpiredOAuthStates(): Promise<number> {
  const result = await prisma.socialOAuthState.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  return result.count;
}

/*
 * ---------------------------------------------------------------------------
 * The page-selection handoff
 * ---------------------------------------------------------------------------
 *
 * A provider's callback does not finish a connection. Meta hands back an
 * authorization; which Pages it manages is a separate Graph call; and only a
 * person can say which of those Pages this client actually is. Between those
 * two moments the authorization has to be somewhere, and it may not be the
 * browser.
 *
 * So it waits on the flow's own row, encrypted with the SAME
 * publishing-credential infrastructure — not a second crypto implementation —
 * behind a fresh single-use token whose hash alone is stored. Short-lived,
 * cleared on completion, refused after expiry.
 */

/** Five minutes. A person choosing from a list they are already looking at. */
export const SELECTION_TTL_MS = 5 * 60 * 1000;

const SELECTION_BYTES = 32;
const PENDING_ENVELOPE_KIND = "social_pending_oauth2" as const;
const PENDING_ENVELOPE_VERSION = 1 as const;

/**
 * What waits on the row. The discovered accounts are public information and
 * are encrypted anyway — one opaque blob is simpler to reason about than a
 * secret column beside a public one.
 */
type PendingEnvelope = {
  kind: typeof PENDING_ENVELOPE_KIND;
  v: typeof PENDING_ENVELOPE_VERSION;
  accessToken: string;
  /** ISO, or null when the provider stated no expiry. */
  expiresAt: string | null;
  grantedScopes: string[];
  discovered: DiscoveredAccount[];
};

export type PendingAuthorization = {
  authorization: ProviderAuthorization;
  discovered: DiscoveredAccount[];
};

export type ClaimSelectionResult =
  | { ok: true; context: OAuthFlowContext; pending: PendingAuthorization }
  | { ok: false; reason: "MALFORMED" | "UNKNOWN" | "EXPIRED" | "ALREADY_USED" | "UNREADABLE" };

/**
 * Parks a completed authorization against its flow and returns the single-use
 * token that identifies it. Only the token's hash is stored.
 *
 * `stateId` is the row this flow already owns — found by the callback through
 * the state it just consumed — so this can never attach an authorization to
 * someone else's flow.
 */
export async function stashPendingAuthorization(input: {
  stateHashOfConsumedState: string;
  authorization: ProviderAuthorization;
  discovered: DiscoveredAccount[];
}): Promise<string> {
  const selectionToken = randomBytes(SELECTION_BYTES).toString("base64url");

  const envelope: PendingEnvelope = {
    kind: PENDING_ENVELOPE_KIND,
    v: PENDING_ENVELOPE_VERSION,
    accessToken: input.authorization.accessToken,
    expiresAt: input.authorization.expiresAt ? input.authorization.expiresAt.toISOString() : null,
    grantedScopes: input.authorization.grantedScopes,
    discovered: input.discovered,
  };
  const { encryptedPayload, encryptionKeyVersion } = encryptCredentialPayload(JSON.stringify(envelope));

  await prisma.socialOAuthState.update({
    where: { stateHash: input.stateHashOfConsumedState },
    data: {
      selectionHash: hashState(selectionToken),
      selectionExpiresAt: new Date(Date.now() + SELECTION_TTL_MS),
      selectionConsumedAt: null,
      encryptedAuthorization: encryptedPayload,
      authorizationKeyVersion: encryptionKeyVersion,
    },
  });

  return selectionToken;
}

/**
 * Redeems a selection token exactly once, returning the flow's context AND
 * the parked authorization.
 *
 * The context comes from the row, never from the caller: the company, client
 * and platform a selection applies to are whatever was recorded when the flow
 * started. A browser cannot redirect a selection at another company's client
 * by sending different ids, because no id it sends is read.
 */
export async function claimPendingAuthorization(rawToken: string | null | undefined): Promise<ClaimSelectionResult> {
  if (typeof rawToken !== "string" || rawToken.length < 16 || rawToken.length > 512) {
    return { ok: false, reason: "MALFORMED" };
  }

  const selectionHash = hashState(rawToken);
  const now = new Date();

  const row = await prisma.socialOAuthState.findUnique({
    where: { selectionHash },
    select: {
      companyId: true,
      clientId: true,
      platform: true,
      socialAccountId: true,
      startedByUserId: true,
      selectionExpiresAt: true,
      selectionConsumedAt: true,
      encryptedAuthorization: true,
      authorizationKeyVersion: true,
    },
  });
  if (!row) return { ok: false, reason: "UNKNOWN" };
  if (row.selectionConsumedAt !== null) return { ok: false, reason: "ALREADY_USED" };
  if (!row.selectionExpiresAt || row.selectionExpiresAt <= now) return { ok: false, reason: "EXPIRED" };

  // The conditional UPDATE is the real single-use guard; the read above only names the failure.
  const claimed = await prisma.socialOAuthState.updateMany({
    where: { selectionHash, selectionConsumedAt: null, selectionExpiresAt: { gt: now } },
    data: { selectionConsumedAt: now },
  });
  if (claimed.count !== 1) return { ok: false, reason: "ALREADY_USED" };

  if (!row.encryptedAuthorization || row.authorizationKeyVersion === null) {
    return { ok: false, reason: "UNREADABLE" };
  }

  let envelope: PendingEnvelope;
  try {
    const plaintext = decryptCredentialPayload(row.encryptedAuthorization, row.authorizationKeyVersion);
    const parsed: unknown = JSON.parse(plaintext);
    if (!isPendingEnvelope(parsed)) return { ok: false, reason: "UNREADABLE" };
    envelope = parsed;
  } catch {
    // Never includes the ciphertext or anything derived from it.
    return { ok: false, reason: "UNREADABLE" };
  }

  return {
    ok: true,
    context: {
      companyId: row.companyId,
      clientId: row.clientId,
      platform: row.platform,
      socialAccountId: row.socialAccountId,
      startedByUserId: row.startedByUserId,
    },
    pending: {
      authorization: {
        accessToken: envelope.accessToken,
        expiresAt: envelope.expiresAt ? new Date(envelope.expiresAt) : null,
        grantedScopes: envelope.grantedScopes,
      },
      discovered: envelope.discovered,
    },
  };
}

/**
 * Wipes the parked authorization once a flow is finished or abandoned.
 *
 * Called on success AND on failure: a token left sitting encrypted on a
 * consumed row has no purpose, and the shortest life is the safest one. The
 * row itself stays, so the audit trail of the attempt survives.
 */
export async function clearPendingAuthorization(selectionHash: string): Promise<void> {
  await prisma.socialOAuthState.updateMany({
    where: { selectionHash },
    data: { encryptedAuthorization: null, authorizationKeyVersion: null },
  });
}

/** The stored hash for a raw token, so a caller can clear the row it just claimed. */
export function selectionHashOf(rawToken: string): string {
  return hashState(rawToken);
}

/** The stored hash for a raw state value, so the callback can park onto its own row. */
export function stateHashOf(rawState: string): string {
  return hashState(rawState);
}

function isPendingEnvelope(value: unknown): value is PendingEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.kind === PENDING_ENVELOPE_KIND &&
    candidate.v === PENDING_ENVELOPE_VERSION &&
    typeof candidate.accessToken === "string" &&
    candidate.accessToken.length > 0 &&
    (candidate.expiresAt === null || typeof candidate.expiresAt === "string") &&
    Array.isArray(candidate.grantedScopes) &&
    Array.isArray(candidate.discovered)
  );
}

/**
 * The pages a provider offered, WITHOUT redeeming the selection token.
 *
 * The page-selection screen has to render the list before a person chooses,
 * and redeeming on render would burn the single use on a page refresh. So
 * this reads the same row and returns only the discovered accounts — public
 * information — and deliberately has no way to return the access token. The
 * redemption still happens exactly once, in `claimPendingAuthorization`.
 */
export async function peekDiscoveredAccounts(rawToken: string | null | undefined): Promise<
  | { ok: true; companyId: string; clientId: string; platform: SocialPlatform; discovered: DiscoveredAccount[] }
  | { ok: false; reason: "MALFORMED" | "UNKNOWN" | "EXPIRED" | "ALREADY_USED" | "UNREADABLE" }
> {
  if (typeof rawToken !== "string" || rawToken.length < 16 || rawToken.length > 512) {
    return { ok: false, reason: "MALFORMED" };
  }

  const row = await prisma.socialOAuthState.findUnique({
    where: { selectionHash: hashState(rawToken) },
    select: {
      companyId: true,
      clientId: true,
      platform: true,
      selectionExpiresAt: true,
      selectionConsumedAt: true,
      encryptedAuthorization: true,
      authorizationKeyVersion: true,
    },
  });
  if (!row) return { ok: false, reason: "UNKNOWN" };
  if (row.selectionConsumedAt !== null) return { ok: false, reason: "ALREADY_USED" };
  if (!row.selectionExpiresAt || row.selectionExpiresAt <= new Date()) return { ok: false, reason: "EXPIRED" };
  if (!row.encryptedAuthorization || row.authorizationKeyVersion === null) return { ok: false, reason: "UNREADABLE" };

  try {
    const plaintext = decryptCredentialPayload(row.encryptedAuthorization, row.authorizationKeyVersion);
    const parsed: unknown = JSON.parse(plaintext);
    if (!isPendingEnvelope(parsed)) return { ok: false, reason: "UNREADABLE" };
    /* Only `discovered` is destructured out. The access token stays in this scope and is discarded. */
    return {
      ok: true,
      companyId: row.companyId,
      clientId: row.clientId,
      platform: row.platform,
      discovered: parsed.discovered,
    };
  } catch {
    return { ok: false, reason: "UNREADABLE" };
  }
}

/**
 * Clears out a client's earlier, unfinished flows for one platform before a
 * new one starts.
 *
 * Two different situations, treated differently on purpose:
 *
 *  - NEVER CONSUMED — someone pressed Connect and walked away. The row records
 *    nothing that happened, so it is deleted outright. This is also what stops
 *    a pile of live states accumulating: pressing Connect twice must not leave
 *    two usable nonces lying around, and reconnecting must never be able to
 *    pick up an old one.
 *
 *  - CONSUMED BUT NOT FINISHED — someone authorized, reached the page picker
 *    and abandoned it. That attempt is worth keeping for audit, but the parked
 *    authorization is not: the ciphertext is wiped and the selection token is
 *    retired, so nothing decryptable and nothing redeemable survives.
 *
 * Returns how many rows were deleted, for the log.
 */
export async function discardUnfinishedFlows(input: {
  companyId: string;
  clientId: string;
  platform: SocialPlatform;
}): Promise<number> {
  const scope = { companyId: input.companyId, clientId: input.clientId, platform: input.platform };

  await prisma.socialOAuthState.updateMany({
    where: { ...scope, consumedAt: { not: null }, encryptedAuthorization: { not: null }, selectionConsumedAt: null },
    data: {
      encryptedAuthorization: null,
      authorizationKeyVersion: null,
      selectionHash: null,
      selectionExpiresAt: null,
    },
  });

  const deleted = await prisma.socialOAuthState.deleteMany({ where: { ...scope, consumedAt: null } });
  return deleted.count;
}
