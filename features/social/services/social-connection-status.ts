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
