import type { PlatformConnectivity } from "@/features/social/schemas/social-connection.schema";
import type { SocialConnectionState } from "@/lib/generated/prisma/enums";

/**
 * Phase 9 — how a connection state reads on screen.
 *
 * PURE. No Prisma, no environment, no secrets — so the settings screen, the
 * composer and the tests all describe a state through this one function and
 * cannot end up wording it differently.
 *
 * THE RULE THIS ENCODES: only CONNECTED may read as connected. Every other
 * state says, in plain words, that Cloud Compass has not connected to the
 * platform. "Enabled" (the user's own switch) is described separately and is
 * never allowed to imply a connection.
 *
 * No OAuth vocabulary. A person reads "Not connected", not "no valid
 * access token".
 */

export type ConnectionAction = "CONNECT" | "RECONNECT" | null;

export type ConnectionDescription = {
  state: SocialConnectionState;
  /** Two or three words, e.g. "Not connected". */
  label: string;
  /** One sentence saying what that means for this account. */
  detail: string;
  /** Which action, if any, is worth offering. */
  action: ConnectionAction;
  /** True for CONNECTED alone. Anything reading this to decide "is it real" gets one answer. */
  isConnected: boolean;
  /** True when something needs a person's attention, so a screen can mark it. */
  needsAttention: boolean;
};

export function describeConnection(state: SocialConnectionState): ConnectionDescription {
  switch (state) {
    case "CONNECTED":
      return {
        state,
        label: "Connected",
        detail: "Cloud Compass is authorized on this platform for this account.",
        action: null,
        isConnected: true,
        needsAttention: false,
      };
    case "NEEDS_RECONNECT":
      return {
        state,
        label: "Connection needs attention",
        detail: "The platform stopped accepting this authorization. Reconnect to restore it.",
        action: "RECONNECT",
        isConnected: false,
        needsAttention: true,
      };
    case "DISCONNECTED":
      return {
        state,
        label: "Disconnected",
        detail: "This connection was disconnected here. The account details are kept.",
        action: "CONNECT",
        isConnected: false,
        needsAttention: false,
      };
    case "NOT_CONNECTED":
    default:
      return {
        state: "NOT_CONNECTED",
        label: "Not connected",
        detail: "Added by hand, so Cloud Compass has not connected to the platform for this account.",
        action: "CONNECT",
        isConnected: false,
        needsAttention: false,
      };
  }
}

/**
 * What the user's own switch means, kept apart from the connection so the two
 * can never be muddled in copy again. "Enabled" says a person wants this
 * account available in Cloud Compass — nothing about the platform.
 */
export function describeAvailability(status: "ACTIVE" | "DISCONNECTED"): { label: string; detail: string } {
  return status === "ACTIVE"
    ? { label: "Enabled", detail: "Available to choose when writing a post." }
    : { label: "Disabled", detail: "Not offered for new posts. Existing posts are unchanged." };
}

/**
 * Phase 9E — whether a PLATFORM itself can be connected right now, as one
 * deterministic three-state model instead of the two ad-hoc booleans
 * (connectable, configured) that SocialConnectionRow and the settings page
 * used to each re-check with their own slightly different wording.
 *
 * THIS IS NOT A SECOND REGISTRY. It reads nothing new — PlatformConnectivity
 * already carries exactly these two server-derived facts (from
 * listPlatformConnectivityAction, itself reading socialProviderFor and each
 * provider's own describeConfiguration). This function only gives the
 * combination of those two facts one name and one wording, so a screen never
 * has to re-derive "is this READY" from booleans in more than one place.
 *
 * THE THREE STATES:
 *   NOT_IMPLEMENTED  no SocialProvider exists for this platform at all —
 *                    connectable is false. No environment variable would fix
 *                    this; it needs code, which is why its own sentence never
 *                    mentions configuration.
 *   NOT_CONFIGURED   a provider exists, but this deployment lacks its
 *                    credentials — connectable is true, configured is false.
 *   READY            a provider exists and is configured. Nothing here claims
 *                    a CONNECTION exists — that is connectionState's job,
 *                    described separately by describeConnection.
 *
 * `connectivity` is undefined when the caller has no row for this platform at
 * all (e.g. listPlatformConnectivityAction failed) — treated the same as
 * NOT_IMPLEMENTED, since neither case can honestly offer a Connect action.
 */
export type PlatformCapabilityState = "NOT_IMPLEMENTED" | "NOT_CONFIGURED" | "READY";

export type PlatformCapability = {
  state: PlatformCapabilityState;
  /** Two or three words for the action slot, e.g. "Not available yet". */
  label: string;
  /** One sentence explaining what that means. Empty for READY — nothing to explain. */
  detail: string;
  /**
   * Names of unset environment variables — never values — present only for
   * NOT_CONFIGURED, and only ever populated by listPlatformConnectivityAction
   * for a viewer who may manage configuration. Always [] otherwise.
   */
  missingKeys: string[];
};

export function describePlatformCapability(connectivity: PlatformConnectivity | undefined): PlatformCapability {
  if (!connectivity || !connectivity.connectable) {
    return {
      state: "NOT_IMPLEMENTED",
      label: "Not available yet",
      detail: connectivity?.summary ?? "Connection support is not implemented in this release.",
      missingKeys: [],
    };
  }

  if (!connectivity.configured) {
    return {
      state: "NOT_CONFIGURED",
      label: "Not configured",
      detail: connectivity.summary ?? "This platform is not configured yet.",
      missingKeys: connectivity.missingKeys,
    };
  }

  return { state: "READY", label: "Ready to connect", detail: "", missingKeys: [] };
}
