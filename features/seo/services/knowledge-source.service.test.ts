import { beforeEach, describe, expect, it, vi } from "vitest";

type MockPrisma = {
  knowledgeSource: { findUnique: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
};

function createMockPrisma(): MockPrisma {
  return {
    knowledgeSource: { findUnique: vi.fn(), findMany: vi.fn() },
  };
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { prisma } from "@/lib/prisma";
import {
  findDuplicateKnowledgeSourceByUrl,
  getKnowledgeSourceById,
  listKnowledgeSources,
} from "@/features/seo/services/knowledge-source.service";

const mockedPrisma = prisma as unknown as MockPrisma;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getKnowledgeSourceById", () => {
  it("1. returns null for a non-uuid id without querying prisma", async () => {
    const result = await getKnowledgeSourceById("not-a-uuid");
    expect(result).toBeNull();
    expect(mockedPrisma.knowledgeSource.findUnique).not.toHaveBeenCalled();
  });

  it("2. queries by the exact id for a valid uuid", async () => {
    mockedPrisma.knowledgeSource.findUnique.mockResolvedValue({ id: "source-1" });
    await getKnowledgeSourceById("11111111-1111-7111-8111-111111111111");
    expect(mockedPrisma.knowledgeSource.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "11111111-1111-7111-8111-111111111111" } })
    );
  });
});

describe("listKnowledgeSources", () => {
  it("1. excludes archived rows by default", async () => {
    mockedPrisma.knowledgeSource.findMany.mockResolvedValue([]);
    await listKnowledgeSources("company-a");
    const [{ where }] = mockedPrisma.knowledgeSource.findMany.mock.calls[0];
    expect(where.deletedAt).toBeNull();
  });

  it("2. includes archived rows when explicitly requested", async () => {
    mockedPrisma.knowledgeSource.findMany.mockResolvedValue([]);
    await listKnowledgeSources("company-a", { includeArchived: true });
    const [{ where }] = mockedPrisma.knowledgeSource.findMany.mock.calls[0];
    expect(where.deletedAt).toBeUndefined();
  });

  it("3. [CRITICAL] scopes the query to the given company", async () => {
    mockedPrisma.knowledgeSource.findMany.mockResolvedValue([]);
    await listKnowledgeSources("company-b");
    const [{ where }] = mockedPrisma.knowledgeSource.findMany.mock.calls[0];
    expect(where.companyId).toBe("company-b");
  });
});

describe("findDuplicateKnowledgeSourceByUrl", () => {
  it("1. matches an existing URL that differs only by case", async () => {
    mockedPrisma.knowledgeSource.findMany.mockResolvedValue([{ id: "source-1", url: "https://Example.com/Docs" }]);
    const result = await findDuplicateKnowledgeSourceByUrl("company-a", "https://example.com/docs");
    expect(result).toEqual({ id: "source-1", url: "https://Example.com/Docs" });
  });

  it("2. matches an existing URL that differs only by surrounding whitespace", async () => {
    mockedPrisma.knowledgeSource.findMany.mockResolvedValue([{ id: "source-1", url: "  https://example.com/docs  " }]);
    const result = await findDuplicateKnowledgeSourceByUrl("company-a", "https://example.com/docs");
    expect(result).toEqual({ id: "source-1", url: "  https://example.com/docs  " });
  });

  it("3. returns null when no candidate matches", async () => {
    mockedPrisma.knowledgeSource.findMany.mockResolvedValue([{ id: "source-1", url: "https://example.com/other" }]);
    const result = await findDuplicateKnowledgeSourceByUrl("company-a", "https://example.com/docs");
    expect(result).toBeNull();
  });

  it("4. returns null when the company has no candidates at all", async () => {
    mockedPrisma.knowledgeSource.findMany.mockResolvedValue([]);
    const result = await findDuplicateKnowledgeSourceByUrl("company-a", "https://example.com/docs");
    expect(result).toBeNull();
  });

  it("5. [CRITICAL] scopes the candidate search to the given company only", async () => {
    mockedPrisma.knowledgeSource.findMany.mockResolvedValue([]);
    await findDuplicateKnowledgeSourceByUrl("company-a", "https://example.com/docs");
    const [{ where }] = mockedPrisma.knowledgeSource.findMany.mock.calls[0];
    expect(where.companyId).toBe("company-a");
  });
});
