import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 9 — the OAuth state, tested against a real in-memory table.
 *
 * A hand-written fake stands in for Prisma rather than a mock returning
 * canned values, because what matters here is BEHAVIOUR over time: a state
 * that works once and then does not, an expiry that starts refusing, two
 * callbacks racing. Canned return values cannot express any of that.
 *
 * The real crypto runs, so the parked authorization really is encrypted.
 */
process.env.PUBLISHING_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");

vi.mock("server-only", () => ({}));

type Row = {
  id: string;
  stateHash: string;
  companyId: string;
  clientId: string;
  platform: string;
  socialAccountId: string | null;
  startedByUserId: string | null;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
  selectionHash: string | null;
  selectionExpiresAt: Date | null;
  selectionConsumedAt: Date | null;
  encryptedAuthorization: string | null;
  authorizationKeyVersion: number | null;
};

/** A small honest stand-in for the one table under test. */
const table: Row[] = [];

function matches(row: Row, where: Record<string, unknown>): boolean {
  for (const [key, condition] of Object.entries(where)) {
    const value = (row as unknown as Record<string, unknown>)[key];
    if (condition !== null && typeof condition === "object") {
      const clause = condition as Record<string, unknown>;
      if ("gt" in clause && !(value instanceof Date && value > (clause.gt as Date))) return false;
      if ("lte" in clause && !(value instanceof Date && value <= (clause.lte as Date))) return false;
      continue;
    }
    if (value instanceof Date && condition instanceof Date) {
      if (value.getTime() !== condition.getTime()) return false;
      continue;
    }
    if (value !== condition) return false;
  }
  return true;
}

function project(row: Row, select?: Record<string, boolean>): Record<string, unknown> {
  if (!select) return { ...row } as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(select)) out[key] = (row as unknown as Record<string, unknown>)[key];
  return out;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialOAuthState: {
      create: vi.fn(async ({ data }: { data: Partial<Row> }) => {
        /* Column defaults, applied the way the database would. */
        const row: Row = {
          id: data.id ?? `row-${table.length + 1}`,
          stateHash: data.stateHash!,
          companyId: data.companyId!,
          clientId: data.clientId!,
          platform: data.platform!,
          expiresAt: data.expiresAt!,
          socialAccountId: data.socialAccountId ?? null,
          startedByUserId: data.startedByUserId ?? null,
          consumedAt: data.consumedAt ?? null,
          createdAt: data.createdAt ?? new Date(),
          selectionHash: data.selectionHash ?? null,
          selectionExpiresAt: data.selectionExpiresAt ?? null,
          selectionConsumedAt: data.selectionConsumedAt ?? null,
          encryptedAuthorization: data.encryptedAuthorization ?? null,
          authorizationKeyVersion: data.authorizationKeyVersion ?? null,
        };
        table.push(row);
        return { ...row };
      }),
      findUnique: vi.fn(
        async ({ where, select }: { where: Record<string, unknown>; select?: Record<string, boolean> }) => {
          const row = table.find((candidate) => matches(candidate, where));
          return row ? project(row, select) : null;
        }
      ),
      update: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
        const row = table.find((candidate) => matches(candidate, where));
        if (!row) throw new Error("Row not found");
        Object.assign(row, data);
        return { ...row };
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
        const rows = table.filter((candidate) => matches(candidate, where));
        for (const row of rows) Object.assign(row, data);
        return { count: rows.length };
      }),
      deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const doomed = table.filter((candidate) => matches(candidate, where));
        for (const row of doomed) table.splice(table.indexOf(row), 1);
        return { count: doomed.length };
      }),
    },
  },
}));

import {
  claimPendingAuthorization,
  clearPendingAuthorization,
  consumeOAuthState,
  createOAuthState,
  peekDiscoveredAccounts,
  discardUnfinishedFlows,
  purgeExpiredOAuthStates,
  selectionHashOf,
  stashPendingAuthorization,
  stateHashOf,
  statesMatch,
} from "@/features/social/services/social-oauth-state.service";

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";
const CLIENT_A = "client-a";
const TOKEN = "EAAB-user-token-value";

const flow = (over: Partial<Parameters<typeof createOAuthState>[0]> = {}) => ({
  companyId: COMPANY_A,
  clientId: CLIENT_A,
  platform: "FACEBOOK" as const,
  socialAccountId: null,
  startedByUserId: "user-1",
  ...over,
});

beforeEach(() => {
  table.length = 0;
  vi.clearAllMocks();
});

describe("the state value itself", () => {
  it("1. is unguessable and never repeats", async () => {
    const values = new Set<string>();
    for (let index = 0; index < 25; index += 1) values.add(await createOAuthState(flow()));
    expect(values.size).toBe(25);
    for (const value of values) expect(value.length).toBeGreaterThanOrEqual(40);
  });

  it("2. is NOT stored — only its hash is", async () => {
    const state = await createOAuthState(flow());
    expect(table).toHaveLength(1);
    /* A dump of the row must not contain anything replayable. */
    expect(JSON.stringify(table[0])).not.toContain(state);
    expect(table[0].stateHash).toBe(stateHashOf(state));
    expect(table[0].stateHash).not.toBe(state);
  });

  it("3. records what the flow is FOR, so the callback need trust nothing", async () => {
    await createOAuthState(flow({ socialAccountId: "account-9" }));
    expect(table[0]).toMatchObject({
      companyId: COMPANY_A,
      clientId: CLIENT_A,
      platform: "FACEBOOK",
      socialAccountId: "account-9",
      startedByUserId: "user-1",
    });
  });

  it("4. contains no credential of any kind", async () => {
    await createOAuthState(flow());
    expect(table[0].encryptedAuthorization).toBeNull();
    const keys = Object.keys(table[0]);
    expect(keys).not.toContain("accessToken");
    expect(keys).not.toContain("code");
    expect(keys).not.toContain("clientSecret");
  });
});

describe("redeeming a state", () => {
  it("5. a valid, fresh state is accepted and yields its own context", async () => {
    const state = await createOAuthState(flow());
    const result = await consumeOAuthState(state);
    expect(result.ok).toBe(true);
    expect(result.ok && result.context).toMatchObject({ companyId: COMPANY_A, clientId: CLIENT_A, platform: "FACEBOOK" });
  });

  it("6. a state cannot be used twice", async () => {
    const state = await createOAuthState(flow());
    expect((await consumeOAuthState(state)).ok).toBe(true);
    const replay = await consumeOAuthState(state);
    expect(replay.ok).toBe(false);
    expect(!replay.ok && replay.reason).toBe("ALREADY_USED");
  });

  it("7. a state this server never issued is refused", async () => {
    await createOAuthState(flow());
    const forged = await consumeOAuthState("a-value-nobody-ever-issued-but-long-enough");
    expect(forged.ok).toBe(false);
    expect(!forged.ok && forged.reason).toBe("UNKNOWN");
  });

  it("8. an expired state is refused, and stays refused", async () => {
    const state = await createOAuthState(flow());
    table[0].expiresAt = new Date(Date.now() - 1000);
    const result = await consumeOAuthState(state);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe("EXPIRED");
    /* And it was not consumed as a side effect of being rejected. */
    expect(table[0].consumedAt).toBeNull();
  });

  it("9. a missing, empty or absurd value is refused before any query", async () => {
    for (const value of [null, undefined, "", "short", "x".repeat(600)]) {
      const result = await consumeOAuthState(value);
      expect(result.ok).toBe(false);
      expect(!result.ok && result.reason).toBe("MALFORMED");
    }
  });

  it("10. two callbacks racing on one state produce exactly one winner", async () => {
    const state = await createOAuthState(flow());
    const [first, second] = await Promise.all([consumeOAuthState(state), consumeOAuthState(state)]);
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
  });

  it("11. one company's state cannot be turned into another company's context", async () => {
    /*
     * The context is READ from the row, never supplied — so this is the
     * assertion that a redeemed state can only ever produce the company and
     * client it was created for.
     */
    const stateB = await createOAuthState(flow({ companyId: COMPANY_B, clientId: "client-b" }));
    const result = await consumeOAuthState(stateB);
    expect(result.ok && result.context.companyId).toBe(COMPANY_B);
    expect(result.ok && result.context.clientId).toBe("client-b");
  });

  it("12. states are compared in constant time when compared at all", () => {
    expect(statesMatch("abcdef", "abcdef")).toBe(true);
    expect(statesMatch("abcdef", "abcdeg")).toBe(false);
    expect(statesMatch("abc", "abcdef")).toBe(false);
  });
});

describe("the parked authorization", () => {
  const authorization = { accessToken: TOKEN, expiresAt: null, grantedScopes: ["pages_show_list"] };
  const discovered = [{ externalId: "10001", name: "Catawba Yaupon", handle: null }];

  async function startedAndConsumed() {
    const state = await createOAuthState(flow());
    await consumeOAuthState(state);
    return state;
  }

  it("13. the token is encrypted at rest and appears nowhere in the row", async () => {
    const state = await startedAndConsumed();
    await stashPendingAuthorization({ stateHashOfConsumedState: stateHashOf(state), authorization, discovered });

    expect(table[0].encryptedAuthorization).toBeTruthy();
    expect(JSON.stringify(table[0])).not.toContain(TOKEN);
    expect(table[0].authorizationKeyVersion).toBe(1);
  });

  it("14. the selection token is returned once and stored only as a hash", async () => {
    const state = await startedAndConsumed();
    const selection = await stashPendingAuthorization({
      stateHashOfConsumedState: stateHashOf(state),
      authorization,
      discovered,
    });
    expect(table[0].selectionHash).toBe(selectionHashOf(selection));
    expect(JSON.stringify(table[0])).not.toContain(selection);
  });

  it("15. peeking shows the pages without redeeming anything", async () => {
    const state = await startedAndConsumed();
    const selection = await stashPendingAuthorization({
      stateHashOfConsumedState: stateHashOf(state),
      authorization,
      discovered,
    });

    const first = await peekDiscoveredAccounts(selection);
    expect(first.ok && first.discovered).toEqual(discovered);
    /* A refresh must still work — peeking is not consuming. */
    const second = await peekDiscoveredAccounts(selection);
    expect(second.ok).toBe(true);
    expect(table[0].selectionConsumedAt).toBeNull();
  });

  it("16. peeking never exposes the token", async () => {
    const state = await startedAndConsumed();
    const selection = await stashPendingAuthorization({
      stateHashOfConsumedState: stateHashOf(state),
      authorization,
      discovered,
    });
    const peeked = await peekDiscoveredAccounts(selection);
    expect(JSON.stringify(peeked)).not.toContain(TOKEN);
  });

  it("17. claiming returns the authorization once, and never again", async () => {
    const state = await startedAndConsumed();
    const selection = await stashPendingAuthorization({
      stateHashOfConsumedState: stateHashOf(state),
      authorization,
      discovered,
    });

    const claimed = await claimPendingAuthorization(selection);
    expect(claimed.ok && claimed.pending.authorization.accessToken).toBe(TOKEN);
    expect(claimed.ok && claimed.context.companyId).toBe(COMPANY_A);

    const replay = await claimPendingAuthorization(selection);
    expect(replay.ok).toBe(false);
    expect(!replay.ok && replay.reason).toBe("ALREADY_USED");
  });

  it("18. an expired selection is refused", async () => {
    const state = await startedAndConsumed();
    const selection = await stashPendingAuthorization({
      stateHashOfConsumedState: stateHashOf(state),
      authorization,
      discovered,
    });
    table[0].selectionExpiresAt = new Date(Date.now() - 1000);

    const claimed = await claimPendingAuthorization(selection);
    expect(claimed.ok).toBe(false);
    expect(!claimed.ok && claimed.reason).toBe("EXPIRED");
    expect((await peekDiscoveredAccounts(selection)).ok).toBe(false);
  });

  it("19. a forged selection token is refused", async () => {
    const state = await startedAndConsumed();
    await stashPendingAuthorization({ stateHashOfConsumedState: stateHashOf(state), authorization, discovered });

    const claimed = await claimPendingAuthorization("some-made-up-selection-token-value");
    expect(claimed.ok).toBe(false);
    expect(!claimed.ok && claimed.reason).toBe("UNKNOWN");
  });

  it("20. a claim yields the flow's OWN company and client, not the caller's wishes", async () => {
    const state = await createOAuthState(flow({ companyId: COMPANY_B, clientId: "client-b" }));
    await consumeOAuthState(state);
    const selection = await stashPendingAuthorization({
      stateHashOfConsumedState: stateHashOf(state),
      authorization,
      discovered,
    });

    const claimed = await claimPendingAuthorization(selection);
    expect(claimed.ok && claimed.context.companyId).toBe(COMPANY_B);
    expect(claimed.ok && claimed.context.clientId).toBe("client-b");
  });

  it("21. clearing removes the ciphertext but keeps the audit row", async () => {
    const state = await startedAndConsumed();
    const selection = await stashPendingAuthorization({
      stateHashOfConsumedState: stateHashOf(state),
      authorization,
      discovered,
    });

    await clearPendingAuthorization(selectionHashOf(selection));
    expect(table).toHaveLength(1);
    expect(table[0].encryptedAuthorization).toBeNull();
    expect(table[0].authorizationKeyVersion).toBeNull();
    /* And with nothing parked, a claim can no longer produce a token. */
    const claimed = await claimPendingAuthorization(selection);
    expect(claimed.ok).toBe(false);
  });

  it("22. a claim with unreadable ciphertext fails closed", async () => {
    const state = await startedAndConsumed();
    const selection = await stashPendingAuthorization({
      stateHashOfConsumedState: stateHashOf(state),
      authorization,
      discovered,
    });
    table[0].encryptedAuthorization = "v1:not:real:ciphertext";

    const claimed = await claimPendingAuthorization(selection);
    expect(claimed.ok).toBe(false);
    expect(!claimed.ok && claimed.reason).toBe("UNREADABLE");
  });
});

describe("housekeeping", () => {
  it("23. purging removes only states that can no longer be redeemed", async () => {
    await createOAuthState(flow());
    await createOAuthState(flow());
    table[0].expiresAt = new Date(Date.now() - 1000);

    const removed = await purgeExpiredOAuthStates();
    expect(removed).toBe(1);
    expect(table).toHaveLength(1);
  });
});

/*
 * Phase 9B — starting a new flow must not leave an older one usable.
 */
describe("discarding unfinished flows", () => {
  const authorization = { accessToken: TOKEN, expiresAt: null, grantedScopes: [] };
  const discovered = [{ externalId: "10001", name: "Catawba Yaupon", handle: null }];

  it("24. a never-consumed state is deleted, so a second Connect cannot reuse it", async () => {
    const abandoned = await createOAuthState(flow());
    expect(table).toHaveLength(1);

    const removed = await discardUnfinishedFlows({ companyId: COMPANY_A, clientId: CLIENT_A, platform: "FACEBOOK" });
    expect(removed).toBe(1);
    expect(table).toHaveLength(0);

    /* And it is genuinely dead, not merely hidden. */
    const result = await consumeOAuthState(abandoned);
    expect(result.ok).toBe(false);
  });

  it("25. an abandoned page-picker keeps its audit row but loses its parked authorization", async () => {
    const state = await createOAuthState(flow());
    await consumeOAuthState(state);
    const selection = await stashPendingAuthorization({
      stateHashOfConsumedState: stateHashOf(state),
      authorization,
      discovered,
    });
    expect(table[0].encryptedAuthorization).toBeTruthy();

    await discardUnfinishedFlows({ companyId: COMPANY_A, clientId: CLIENT_A, platform: "FACEBOOK" });

    /* The row survives — the attempt happened and that is worth recording. */
    expect(table).toHaveLength(1);
    expect(table[0].consumedAt).not.toBeNull();
    /* But nothing decryptable and nothing redeemable is left. */
    expect(table[0].encryptedAuthorization).toBeNull();
    expect(table[0].authorizationKeyVersion).toBeNull();
    expect(table[0].selectionHash).toBeNull();
    expect((await claimPendingAuthorization(selection)).ok).toBe(false);
    expect((await peekDiscoveredAccounts(selection)).ok).toBe(false);
  });

  it("26. a FINISHED flow is left completely alone", async () => {
    const state = await createOAuthState(flow());
    await consumeOAuthState(state);
    const selection = await stashPendingAuthorization({
      stateHashOfConsumedState: stateHashOf(state),
      authorization,
      discovered,
    });
    await claimPendingAuthorization(selection);
    const finishedAt = table[0].selectionConsumedAt;

    await discardUnfinishedFlows({ companyId: COMPANY_A, clientId: CLIENT_A, platform: "FACEBOOK" });
    expect(table).toHaveLength(1);
    expect(table[0].selectionConsumedAt).toEqual(finishedAt);
  });

  it("27. ANOTHER COMPANY'S flows are never touched", async () => {
    await createOAuthState(flow({ companyId: COMPANY_B, clientId: "client-b" }));
    await createOAuthState(flow());
    expect(table).toHaveLength(2);

    const removed = await discardUnfinishedFlows({ companyId: COMPANY_A, clientId: CLIENT_A, platform: "FACEBOOK" });
    expect(removed).toBe(1);
    expect(table).toHaveLength(1);
    expect(table[0].companyId).toBe(COMPANY_B);
  });

  it("28. another CLIENT of the same company is never touched", async () => {
    await createOAuthState(flow({ clientId: "client-other" }));
    await createOAuthState(flow());

    const removed = await discardUnfinishedFlows({ companyId: COMPANY_A, clientId: CLIENT_A, platform: "FACEBOOK" });
    expect(removed).toBe(1);
    expect(table).toHaveLength(1);
    expect(table[0].clientId).toBe("client-other");
  });

  it("29. another PLATFORM's flow for the same client is never touched", async () => {
    await createOAuthState({ ...flow(), platform: "INSTAGRAM" });
    await createOAuthState(flow());

    const removed = await discardUnfinishedFlows({ companyId: COMPANY_A, clientId: CLIENT_A, platform: "FACEBOOK" });
    expect(removed).toBe(1);
    expect(table).toHaveLength(1);
    expect(table[0].platform).toBe("INSTAGRAM");
  });

  it("30. discarding nothing is not an error", async () => {
    const removed = await discardUnfinishedFlows({ companyId: COMPANY_A, clientId: CLIENT_A, platform: "FACEBOOK" });
    expect(removed).toBe(0);
  });
});
