import { describe, expect, it } from "vitest";

import { describeAvailability, describeConnection, describePlatformCapability } from "@/features/social/services/social-connection-status";
import type { PlatformConnectivity } from "@/features/social/schemas/social-connection.schema";
import { SocialConnectionState } from "@/lib/generated/prisma/enums";

function connectivity(over: Partial<PlatformConnectivity> = {}): PlatformConnectivity {
  return { platform: "FACEBOOK", connectable: true, configured: true, summary: null, missingKeys: [], ...over };
}

/**
 * Phase 9 — the one rule the whole phase exists for, asserted directly:
 * nothing but CONNECTED may read as connected.
 */
describe("only a genuine connection reads as connected", () => {
  it("1. CONNECTED is the only state whose isConnected is true", () => {
    const states = Object.values(SocialConnectionState);
    const connected = states.filter((state) => describeConnection(state).isConnected);
    expect(connected).toEqual(["CONNECTED"]);
  });

  it("2. no other state's label contains the word Connected on its own", () => {
    for (const state of Object.values(SocialConnectionState)) {
      if (state === "CONNECTED") continue;
      const { label } = describeConnection(state);
      /* "Not connected" is fine; a bare "Connected" is not. */
      expect(label).not.toBe("Connected");
    }
  });

  it("3. NOT_CONNECTED says so plainly, and explains why for a hand-added account", () => {
    const description = describeConnection("NOT_CONNECTED");
    expect(description.label).toBe("Not connected");
    expect(description.detail).toMatch(/has not connected/i);
    expect(description.isConnected).toBe(false);
  });

  it("4. NEEDS_RECONNECT is the only state that asks for attention", () => {
    const needy = Object.values(SocialConnectionState).filter((state) => describeConnection(state).needsAttention);
    expect(needy).toEqual(["NEEDS_RECONNECT"]);
    expect(describeConnection("NEEDS_RECONNECT").action).toBe("RECONNECT");
  });

  it("5. a connected account is offered no connect action, and every other state is", () => {
    expect(describeConnection("CONNECTED").action).toBeNull();
    expect(describeConnection("NOT_CONNECTED").action).toBe("CONNECT");
    expect(describeConnection("DISCONNECTED").action).toBe("CONNECT");
    expect(describeConnection("NEEDS_RECONNECT").action).toBe("RECONNECT");
  });

  it("6. an unknown state falls back to NOT_CONNECTED rather than to connected", () => {
    /* A future enum member must never default to looking like a working connection. */
    const description = describeConnection("SOMETHING_NEW" as SocialConnectionState);
    expect(description.state).toBe("NOT_CONNECTED");
    expect(description.isConnected).toBe(false);
  });

  it("7. no state's wording uses OAuth vocabulary", () => {
    const forbidden = /token|oauth|scope|grant|bearer|credential/i;
    for (const state of Object.values(SocialConnectionState)) {
      const { label, detail } = describeConnection(state);
      expect(label).not.toMatch(forbidden);
      expect(detail).not.toMatch(forbidden);
    }
  });
});

describe("the user's switch is described as a preference, never as a connection", () => {
  it("8. Enabled talks about being available to choose, not about the platform", () => {
    const enabled = describeAvailability("ACTIVE");
    expect(enabled.label).toBe("Enabled");
    expect(enabled.detail).toMatch(/choose/i);
    expect(enabled.detail).not.toMatch(/connect/i);
  });

  it("9. Disabled promises that existing posts are untouched", () => {
    const disabled = describeAvailability("DISCONNECTED");
    expect(disabled.label).toBe("Disabled");
    expect(disabled.detail).toMatch(/unchanged/i);
  });
});

/**
 * Phase 9E — the deterministic capability model: NOT_IMPLEMENTED,
 * NOT_CONFIGURED, READY, derived purely from PlatformConnectivity — the same
 * server-computed facts the settings screen already had, given one name and
 * one wording instead of two ad-hoc boolean checks.
 */
describe("describePlatformCapability distinguishes three, and only three, states", () => {
  it("10. no provider at all is NOT_IMPLEMENTED, never NOT_CONFIGURED", () => {
    const capability = describePlatformCapability(connectivity({ connectable: false, configured: false }));
    expect(capability.state).toBe("NOT_IMPLEMENTED");
  });

  it("11. no connectivity data at all is treated as NOT_IMPLEMENTED, never READY", () => {
    const capability = describePlatformCapability(undefined);
    expect(capability.state).toBe("NOT_IMPLEMENTED");
  });

  it("12. a real provider missing credentials is NOT_CONFIGURED, never NOT_IMPLEMENTED", () => {
    const capability = describePlatformCapability(connectivity({ connectable: true, configured: false }));
    expect(capability.state).toBe("NOT_CONFIGURED");
  });

  it("13. connectable AND configured is READY, and only that combination is", () => {
    expect(describePlatformCapability(connectivity({ connectable: true, configured: true })).state).toBe("READY");
    expect(describePlatformCapability(connectivity({ connectable: false, configured: true })).state).not.toBe("READY");
  });

  it("14. NOT_IMPLEMENTED's wording never mentions configuration — no env var would fix it", () => {
    const capability = describePlatformCapability(connectivity({ connectable: false, configured: false }));
    expect(capability.detail).not.toMatch(/configur|environment|variable/i);
    expect(capability.missingKeys).toEqual([]);
  });

  it("15. NOT_CONFIGURED carries the real missing environment variable names", () => {
    const capability = describePlatformCapability(
      connectivity({ connectable: true, configured: false, missingKeys: ["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"] })
    );
    expect(capability.missingKeys).toEqual(["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"]);
  });

  it("16. READY carries no missing keys and no leftover explanation", () => {
    const capability = describePlatformCapability(connectivity({ connectable: true, configured: true }));
    expect(capability.missingKeys).toEqual([]);
    expect(capability.detail).toBe("");
  });

  it("17. each state's label is distinct — a screen can never confuse one for another", () => {
    const labels = [
      describePlatformCapability(connectivity({ connectable: false })).label,
      describePlatformCapability(connectivity({ connectable: true, configured: false })).label,
      describePlatformCapability(connectivity({ connectable: true, configured: true })).label,
    ];
    expect(new Set(labels).size).toBe(3);
  });

  it("18. no state's wording claims a connection exists", () => {
    for (const c of [
      connectivity({ connectable: false }),
      connectivity({ connectable: true, configured: false }),
      connectivity({ connectable: true, configured: true }),
    ]) {
      const capability = describePlatformCapability(c);
      expect(capability.label).not.toMatch(/^connected$/i);
      expect(capability.detail).not.toMatch(/is connected/i);
    }
  });
});

/**
 * Phase 9E review — the exact predicate SocialConnectionRow and NoAccountCard
 * use to decide "show the real Connect button" vs "show the inert badge".
 *
 * WHY THIS TEST EXISTS, SPECIFICALLY. Section 6/7's requirement is not just
 * that the wording differs between states — it is that a REAL, working
 * button only ever appears for READY, never as a decoration for the other
 * two. This composes the two functions the components actually call
 * (describeConnection + describePlatformCapability) into the identical
 * boolean each component renders behind, so a future change to either
 * function's shape is caught here before it could silently start a Connect
 * button rendering for a platform that is not actually ready.
 */
describe("the real Connect button appears only for READY — never as a decoration", () => {
  /** Mirrors SocialConnectionRow's gate for an account that already exists. */
  function showsRealButtonForExistingAccount(connectionState: SocialConnectionState, connectivity: PlatformConnectivity | undefined) {
    const connection = describeConnection(connectionState);
    const capability = describePlatformCapability(connectivity);
    return connection.action !== null && capability.state === "READY";
  }

  /** Mirrors NoAccountCard's gate for a platform with no account yet. */
  function showsRealButtonForNoAccount(connectivity: PlatformConnectivity | undefined) {
    return describePlatformCapability(connectivity).state === "READY";
  }

  it("19. NOT_CONFIGURED never shows a real button, for an existing account or a fresh platform", () => {
    const notConfigured = connectivity({ connectable: true, configured: false });
    expect(showsRealButtonForExistingAccount("NOT_CONNECTED", notConfigured)).toBe(false);
    expect(showsRealButtonForExistingAccount("DISCONNECTED", notConfigured)).toBe(false);
    expect(showsRealButtonForNoAccount(notConfigured)).toBe(false);
  });

  it("20. NOT_IMPLEMENTED never shows a real button, for an existing account or a fresh platform", () => {
    const notImplemented = connectivity({ connectable: false, configured: false });
    expect(showsRealButtonForExistingAccount("NOT_CONNECTED", notImplemented)).toBe(false);
    expect(showsRealButtonForNoAccount(notImplemented)).toBe(false);
    expect(showsRealButtonForNoAccount(undefined)).toBe(false);
  });

  it("21. READY shows a real button for a fresh platform", () => {
    expect(showsRealButtonForNoAccount(connectivity({ connectable: true, configured: true }))).toBe(true);
  });

  it("22. READY shows a real button for an existing NOT_CONNECTED or DISCONNECTED account", () => {
    const ready = connectivity({ connectable: true, configured: true });
    expect(showsRealButtonForExistingAccount("NOT_CONNECTED", ready)).toBe(true);
    expect(showsRealButtonForExistingAccount("DISCONNECTED", ready)).toBe(true);
    expect(showsRealButtonForExistingAccount("NEEDS_RECONNECT", ready)).toBe(true);
  });

  it("23. READY never shows a real button for an account that is already CONNECTED — there is nothing to connect", () => {
    /* describeConnection("CONNECTED").action is null; Check/Disconnect are the offered actions instead, rendered separately. */
    expect(showsRealButtonForExistingAccount("CONNECTED", connectivity({ connectable: true, configured: true }))).toBe(false);
  });
});
