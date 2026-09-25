import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contentCalendar: { findFirst: vi.fn(), findMany: vi.fn() },
    keyword: { findMany: vi.fn() },
    content: { findMany: vi.fn() },
    keywordCluster: { findFirst: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  filterOwnedContentIds,
  filterOwnedKeywordIds,
  getOwnedCalendar,
  getOwnedKeywordCluster,
  isUuid,
} from "@/features/ai-workspace/services/content-calendar.repository";

const VALID = "01a081cf-210b-72e9-a702-4845948255c7";
const COMPANY = "company-a";
const PROJECT = "01a002a5-ffa5-705e-9731-806267514305";

/**
 * These reads take ids straight from a URL segment and from server-action
 * input. The id columns are `@db.Uuid`, so a non-UUID value raises a driver
 * error instead of matching nothing — which surfaced in the browser as
 * "Something went wrong" rather than a clean not-found. These tests pin the
 * guard that fixed it.
 */

describe("isUuid", () => {
  it("1. accepts a real uuid in either case", () => {
    expect(isUuid(VALID)).toBe(true);
    expect(isUuid(VALID.toUpperCase())).toBe(true);
  });

  it("2. rejects the shapes a URL or a client can actually produce", () => {
    for (const value of ["", "   ", "not-a-uuid", "123", "../../etc/passwd", "01a081cf210b72e9a7024845948255c7", VALID + "x", VALID.slice(0, -1)]) {
      expect(isUuid(value)).toBe(false);
    }
  });

  it("3. rejects non-strings", () => {
    for (const value of [null, undefined, 42, {}, [], true]) {
      expect(isUuid(value)).toBe(false);
    }
  });
});

describe("getOwnedCalendar — a garbage id is not found, never a crash", () => {
  it("4. never queries the database for a malformed id", async () => {
    vi.mocked(prisma.contentCalendar.findFirst).mockClear();
    for (const bad of ["not-a-uuid", "", "1", "null"]) {
      expect(await getOwnedCalendar(bad, COMPANY)).toBeNull();
    }
    expect(prisma.contentCalendar.findFirst).not.toHaveBeenCalled();
  });

  it("5. queries — scoped to the company and excluding trashed rows — for a well-formed id", async () => {
    vi.mocked(prisma.contentCalendar.findFirst).mockClear();
    vi.mocked(prisma.contentCalendar.findFirst).mockResolvedValue(null as never);

    await getOwnedCalendar(VALID, COMPANY);

    expect(prisma.contentCalendar.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: VALID, deletedAt: null, seoProject: { companyId: COMPANY, deletedAt: null } },
      })
    );
  });
});

describe("getOwnedKeywordCluster — same guard", () => {
  it("6. returns null for a malformed cluster id without querying", async () => {
    vi.mocked(prisma.keywordCluster.findFirst).mockClear();
    expect(await getOwnedKeywordCluster("nope", PROJECT)).toBeNull();
    expect(prisma.keywordCluster.findFirst).not.toHaveBeenCalled();
  });

  it("7. scopes a well-formed lookup to the project and excludes trashed rows", async () => {
    vi.mocked(prisma.keywordCluster.findFirst).mockClear();
    vi.mocked(prisma.keywordCluster.findFirst).mockResolvedValue(null as never);

    await getOwnedKeywordCluster(VALID, PROJECT);

    expect(prisma.keywordCluster.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: VALID, seoProjectId: PROJECT, deletedAt: null } })
    );
  });
});

describe("filterOwnedKeywordIds / filterOwnedContentIds", () => {
  it("8. drops malformed ids before querying, so they read as unowned", async () => {
    vi.mocked(prisma.keyword.findMany).mockClear();
    expect(await filterOwnedKeywordIds(["nope", ""], PROJECT)).toEqual(new Set());
    expect(prisma.keyword.findMany).not.toHaveBeenCalled();
  });

  it("9. queries only the well-formed ids, scoped to the project", async () => {
    vi.mocked(prisma.keyword.findMany).mockClear();
    vi.mocked(prisma.keyword.findMany).mockResolvedValue([{ id: VALID }] as never);

    const owned = await filterOwnedKeywordIds([VALID, "nope"], PROJECT);

    expect(prisma.keyword.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [VALID] }, seoProjectId: PROJECT, deletedAt: null } })
    );
    expect(owned).toEqual(new Set([VALID]));
  });

  it("10. de-duplicates repeated ids", async () => {
    vi.mocked(prisma.keyword.findMany).mockClear();
    vi.mocked(prisma.keyword.findMany).mockResolvedValue([] as never);

    await filterOwnedKeywordIds([VALID, VALID, VALID], PROJECT);

    expect(prisma.keyword.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { in: [VALID] } }) }));
  });

  it("11. returns an empty set for an empty list without querying", async () => {
    vi.mocked(prisma.content.findMany).mockClear();
    expect(await filterOwnedContentIds([], PROJECT)).toEqual(new Set());
    expect(prisma.content.findMany).not.toHaveBeenCalled();
  });

  it("12. content ids are scoped to the project and exclude trashed pages", async () => {
    vi.mocked(prisma.content.findMany).mockClear();
    vi.mocked(prisma.content.findMany).mockResolvedValue([{ id: VALID }] as never);

    await filterOwnedContentIds([VALID], PROJECT);

    expect(prisma.content.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [VALID] }, seoProjectId: PROJECT, deletedAt: null } })
    );
  });
});
