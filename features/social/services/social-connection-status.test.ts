import { describe, expect, it } from "vitest";

import { describeAvailability, describeConnection } from "@/features/social/services/social-connection-status";
import { SocialConnectionState } from "@/lib/generated/prisma/enums";

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
