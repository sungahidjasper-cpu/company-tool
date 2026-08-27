import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/seo/services/knowledge-source.service", () => ({
  listKnowledgeSourceLinksForSeoProject: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { sEOProject: { findUnique: vi.fn() } },
}));

import { prisma } from "@/lib/prisma";
import { listKnowledgeSourceLinksForSeoProject } from "@/features/seo/services/knowledge-source.service";
import {
  getKnowledgeSourceContextForSeoProject,
  getVerifiedKnowledgeSourceContextForJob,
} from "@/features/seo/services/knowledge-source-context.service";

const mockedListLinks = listKnowledgeSourceLinksForSeoProject as unknown as ReturnType<typeof vi.fn>;
const mockedFindProject = vi.mocked(prisma.sEOProject.findUnique);

function makeSource(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "source-1",
    title: "Google Search Central",
    url: "https://developers.google.com/search",
    description: "Official Google Search documentation",
    content: null,
    deletedAt: null,
    ...overrides,
  };
}

function makeLink(source: ReturnType<typeof makeSource>, overrides: Partial<Record<string, unknown>> = {}) {
  return { id: "link-1", knowledgeSource: source, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getKnowledgeSourceContextForSeoProject", () => {
  it("1. returns null when the project has no linked sources", async () => {
    mockedListLinks.mockResolvedValue([]);
    const result = await getKnowledgeSourceContextForSeoProject("project-1");
    expect(result).toBeNull();
  });

  it("2. looks up links by the exact seoProjectId", async () => {
    mockedListLinks.mockResolvedValue([]);
    await getKnowledgeSourceContextForSeoProject("project-1");
    expect(mockedListLinks).toHaveBeenCalledWith("project-1");
  });

  it("3. [CRITICAL] excludes an archived (deletedAt set) source entirely, even though its link still exists", async () => {
    mockedListLinks.mockResolvedValue([makeLink(makeSource({ deletedAt: new Date() }))]);
    const result = await getKnowledgeSourceContextForSeoProject("project-1");
    expect(result).toBeNull();
  });

  it("4. includes the source's title in the returned context", async () => {
    mockedListLinks.mockResolvedValue([makeLink(makeSource())]);
    const result = await getKnowledgeSourceContextForSeoProject("project-1");
    expect(result).toContain("Google Search Central");
  });

  it("5. includes the source's URL when present", async () => {
    mockedListLinks.mockResolvedValue([makeLink(makeSource())]);
    const result = await getKnowledgeSourceContextForSeoProject("project-1");
    expect(result).toContain("https://developers.google.com/search");
  });

  it("6. omits a URL entirely when the source has none, without leaving an empty parenthesis", async () => {
    mockedListLinks.mockResolvedValue([makeLink(makeSource({ url: null }))]);
    const result = await getKnowledgeSourceContextForSeoProject("project-1");
    expect(result).not.toContain("()");
  });

  it("7. includes the source's content excerpt when present", async () => {
    mockedListLinks.mockResolvedValue([makeLink(makeSource({ content: "Google indexes pages via Googlebot." }))]);
    const result = await getKnowledgeSourceContextForSeoProject("project-1");
    expect(result).toContain("Google indexes pages via Googlebot.");
  });

  it("8. truncates a content excerpt longer than the cap, with an ellipsis", async () => {
    const longContent = "x".repeat(1000);
    mockedListLinks.mockResolvedValue([makeLink(makeSource({ content: longContent }))]);
    const result = await getKnowledgeSourceContextForSeoProject("project-1");
    expect(result).toContain("…");
    expect(result!.length).toBeLessThan(longContent.length + 200);
  });

  it("9. [CRITICAL] deduplicates the same source linked more than once — appears exactly once", async () => {
    const source = makeSource();
    mockedListLinks.mockResolvedValue([makeLink(source, { id: "link-1" }), makeLink(source, { id: "link-2" })]);
    const result = await getKnowledgeSourceContextForSeoProject("project-1");
    const occurrences = result!.split("Google Search Central").length - 1;
    expect(occurrences).toBe(1);
  });

  it("10. caps the number of sources included at the configured maximum", async () => {
    const links = Array.from({ length: 8 }, (_, i) =>
      makeLink(makeSource({ id: `source-${i}`, title: `Source ${i}` }), { id: `link-${i}` })
    );
    mockedListLinks.mockResolvedValue(links);
    const result = await getKnowledgeSourceContextForSeoProject("project-1");
    for (let i = 0; i < 5; i++) expect(result).toContain(`Source ${i}`);
    for (let i = 5; i < 8; i++) expect(result).not.toContain(`Source ${i}`);
  });

  it("11. formats a title-only source (no url/description/content) without leaving stray separators", async () => {
    mockedListLinks.mockResolvedValue([makeLink(makeSource({ url: null, description: null, content: null }))]);
    const result = await getKnowledgeSourceContextForSeoProject("project-1");
    expect(result!.endsWith("- Google Search Central")).toBe(true);
  });

  it("12. begins with a clear label the model can use to distinguish this from other prompt content", async () => {
    mockedListLinks.mockResolvedValue([makeLink(makeSource())]);
    const result = await getKnowledgeSourceContextForSeoProject("project-1");
    expect(result).toMatch(/^Supplied authoritative sources/);
  });
});

describe("getVerifiedKnowledgeSourceContextForJob (Phase 30 Stage 8)", () => {
  const COMPANY_ID = "company-1";
  const PROJECT_ID = "project-1";

  it("1. returns null without querying anything when seoProjectId is null", async () => {
    const result = await getVerifiedKnowledgeSourceContextForJob(COMPANY_ID, null);
    expect(result).toBeNull();
    expect(mockedFindProject).not.toHaveBeenCalled();
    expect(mockedListLinks).not.toHaveBeenCalled();
  });

  it("2. returns null without querying anything when seoProjectId is undefined", async () => {
    const result = await getVerifiedKnowledgeSourceContextForJob(COMPANY_ID, undefined);
    expect(result).toBeNull();
    expect(mockedFindProject).not.toHaveBeenCalled();
  });

  it("3. returns null when the referenced SEO project doesn't exist", async () => {
    mockedFindProject.mockResolvedValue(null);
    const result = await getVerifiedKnowledgeSourceContextForJob(COMPANY_ID, PROJECT_ID);
    expect(result).toBeNull();
    expect(mockedListLinks).not.toHaveBeenCalled();
  });

  it("4. [CRITICAL] returns null — never another company's context — when the project belongs to a different company than the job", async () => {
    mockedFindProject.mockResolvedValue({ companyId: "some-other-company" } as never);
    const result = await getVerifiedKnowledgeSourceContextForJob(COMPANY_ID, PROJECT_ID);
    expect(result).toBeNull();
    // The tenant check must short-circuit before ever reading that project's linked sources.
    expect(mockedListLinks).not.toHaveBeenCalled();
  });

  it("5. looks up the project by the exact seoProjectId given", async () => {
    mockedFindProject.mockResolvedValue(null);
    await getVerifiedKnowledgeSourceContextForJob(COMPANY_ID, PROJECT_ID);
    expect(mockedFindProject).toHaveBeenCalledWith(expect.objectContaining({ where: { id: PROJECT_ID } }));
  });

  it("6. delegates to getKnowledgeSourceContextForSeoProject and returns its result when the project genuinely belongs to the given company", async () => {
    mockedFindProject.mockResolvedValue({ companyId: COMPANY_ID } as never);
    mockedListLinks.mockResolvedValue([makeLink(makeSource())]);
    const result = await getVerifiedKnowledgeSourceContextForJob(COMPANY_ID, PROJECT_ID);
    expect(result).toContain("Google Search Central");
    expect(mockedListLinks).toHaveBeenCalledWith(PROJECT_ID);
  });

  it("7. returns null (not an error) when the project matches but has no linked sources", async () => {
    mockedFindProject.mockResolvedValue({ companyId: COMPANY_ID } as never);
    mockedListLinks.mockResolvedValue([]);
    const result = await getVerifiedKnowledgeSourceContextForJob(COMPANY_ID, PROJECT_ID);
    expect(result).toBeNull();
  });
});
