import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/structured-output", () => ({
  generateStructuredOutput: vi.fn(),
  generateStructuredOutputStreaming: vi.fn(),
}));
vi.mock("@/features/companies/services/brand-profile.service", () => ({
  getBrandProfileByCompanyId: vi.fn(),
}));

import { generateStructuredOutput, generateStructuredOutputStreaming } from "@/lib/ai/structured-output";
import { getBrandProfileByCompanyId } from "@/features/companies/services/brand-profile.service";
import { buildPrompt, filterValidRecommendations, generateInternalLinkRecommendations, INTERNAL_LINK_ANALYZER_SYSTEM_PROMPT, PROMPT_VERSION, type InternalLinkAnalyzerContext } from "@/features/ai-workspace/services/internal-link-analyzer.service";

const mockGenerate = vi.mocked(generateStructuredOutput);
const mockGenerateStreaming = vi.mocked(generateStructuredOutputStreaming);
const mockGetBrandProfile = vi.mocked(getBrandProfileByCompanyId);

beforeEach(() => {
  mockGenerate.mockReset();
  mockGenerateStreaming.mockReset();
  mockGetBrandProfile.mockReset();
  mockGetBrandProfile.mockResolvedValue(null);
});

const BASE_CTX: InternalLinkAnalyzerContext = {
  seoProjectId: "project-1",
  companyId: "company-1",
  seoProjectName: "Acme Plumbing",
  domain: "acme-plumbing.example.com",
  sourceContent: { title: "Emergency Plumbing Guide", url: "https://acme-plumbing.example.com/emergency", metaDescription: "24/7 emergency plumbing tips.", body: "If you have a burst pipe, shut off the main water valve immediately." },
  inventory: [
    { title: "Our Services", url: "https://acme-plumbing.example.com/services" },
    { title: "Contact Us", url: "https://acme-plumbing.example.com/contact" },
  ],
};

const VALID_REC = { anchorText: "our plumbing services", targetPage: "https://acme-plumbing.example.com/services", reason: "The source page discusses emergency plumbing, directly related to the services page.", placement: "in the introduction", priority: "HIGH" };

describe("buildPrompt", () => {
  it("includes the source page title, url, and description", () => {
    const prompt = buildPrompt(BASE_CTX);
    expect(prompt).toContain('Source page to analyze: "Emergency Plumbing Guide" (https://acme-plumbing.example.com/emergency)');
    expect(prompt).toContain("Source page description: 24/7 emergency plumbing tips.");
  });

  it("includes a truncated body excerpt", () => {
    const prompt = buildPrompt(BASE_CTX);
    expect(prompt).toContain("shut off the main water valve immediately");
  });

  it("lists every inventory page with its exact url, and states inventory pages are the only legal targets", () => {
    const prompt = buildPrompt(BASE_CTX);
    expect(prompt).toContain('- "Our Services" (https://acme-plumbing.example.com/services)');
    expect(prompt).toContain('- "Contact Us" (https://acme-plumbing.example.com/contact)');
    expect(prompt).toContain("The ONLY pages that exist on this site and may be recommended as link targets are:");
  });

  it("states plainly when the project has no other pages to link to", () => {
    const prompt = buildPrompt({ ...BASE_CTX, inventory: [] });
    expect(prompt).toContain("No other pages exist in this project yet");
  });

  it("allows zero recommendations and instructs removing an unjustifiable recommendation rather than guessing", () => {
    const prompt = buildPrompt(BASE_CTX);
    expect(prompt).toContain("zero is an acceptable answer if the source content doesn't genuinely call for a link");
    expect(prompt).toContain("remove that recommendation rather than guessing");
  });

  it("includes Brand Profile fields when supplied, as supplementary context only", () => {
    const prompt = buildPrompt(BASE_CTX, { brandName: "Acme Plumbing Co", productsServices: "Emergency plumbing repair" } as never);
    expect(prompt).toContain("Brand name: Acme Plumbing Co.");
    expect(prompt).toContain("Products/services: Emergency plumbing repair.");
  });

  it("omits Brand Profile lines when none is supplied", () => {
    const prompt = buildPrompt(BASE_CTX, null);
    expect(prompt).not.toContain("Brand name:");
    expect(prompt).not.toContain("Products/services:");
  });
});

describe("INTERNAL_LINK_ANALYZER_SYSTEM_PROMPT", () => {
  it("establishes the supplied page list as the sole source of truth and forbids inventing a url or target page", () => {
    expect(INTERNAL_LINK_ANALYZER_SYSTEM_PROMPT).toContain("is the ONLY source of truth for what pages exist on this site");
    expect(INTERNAL_LINK_ANALYZER_SYSTEM_PROMPT).toContain("Never invent a url, never invent a page title, never recommend a target page that is absent from the supplied list");
  });

  it("forbids recommending purely for theoretical SEO value and requires contextual relevance", () => {
    expect(INTERNAL_LINK_ANALYZER_SYSTEM_PROMPT).toContain("Do not recommend a link merely because it would theoretically be useful for SEO");
  });

  it("forbids recommending an external or non-listed page as an internal-link target", () => {
    expect(INTERNAL_LINK_ANALYZER_SYSTEM_PROMPT).toContain("Never recommend an external competitor page, or any page not in the supplied list, as a link target");
  });
});

describe("filterValidRecommendations", () => {
  const validTargets = new Set(["https://acme-plumbing.example.com/services", "https://acme-plumbing.example.com/contact"]);

  it("1. accepts a well-formed recommendation whose targetPage is an exact match against the supplied inventory", () => {
    expect(filterValidRecommendations([VALID_REC], validTargets)).toEqual([VALID_REC]);
  });

  it("2. rejects a recommendation whose targetPage is a fabricated url not in the inventory", () => {
    const rec = { ...VALID_REC, targetPage: "https://acme-plumbing.example.com/invented-page" };
    expect(filterValidRecommendations([rec], validTargets)).toEqual([]);
  });

  it("3. rejects a recommendation whose targetPage is a page TITLE instead of the exact url", () => {
    const rec = { ...VALID_REC, targetPage: "Our Services" };
    expect(filterValidRecommendations([rec], validTargets)).toEqual([]);
  });

  it("4. rejects a recommendation with an invalid priority value", () => {
    const rec = { ...VALID_REC, priority: "SUPER HIGH" };
    expect(filterValidRecommendations([rec], validTargets)).toEqual([]);
  });

  it("5. rejects a recommendation missing a required field", () => {
    const missingAnchor = { targetPage: VALID_REC.targetPage, reason: VALID_REC.reason, placement: VALID_REC.placement, priority: VALID_REC.priority };
    expect(filterValidRecommendations([missingAnchor], validTargets)).toEqual([]);
  });

  it("6. rejects a recommendation with a blank/whitespace-only anchorText, reason, or placement", () => {
    expect(filterValidRecommendations([{ ...VALID_REC, anchorText: "   " }], validTargets)).toEqual([]);
    expect(filterValidRecommendations([{ ...VALID_REC, reason: "" }], validTargets)).toEqual([]);
    expect(filterValidRecommendations([{ ...VALID_REC, placement: "  " }], validTargets)).toEqual([]);
  });

  it("7. rejects a structurally malformed item (not an object) without throwing", () => {
    expect(filterValidRecommendations(["just a string"], validTargets)).toEqual([]);
    expect(filterValidRecommendations([null], validTargets)).toEqual([]);
  });

  it("8. keeps valid recommendations while dropping only the invalid ones in the same batch", () => {
    const invalidRec = { ...VALID_REC, targetPage: "https://fabricated.example.com/" };
    expect(filterValidRecommendations([VALID_REC, invalidRec], validTargets)).toEqual([VALID_REC]);
  });

  it("9. returns an empty array, not an error, when every recommendation is invalid", () => {
    const invalidRec = { ...VALID_REC, targetPage: "https://fabricated.example.com/" };
    expect(filterValidRecommendations([invalidRec], validTargets)).toEqual([]);
  });

  it("10. returns an empty array unchanged for an empty input", () => {
    expect(filterValidRecommendations([], validTargets)).toEqual([]);
  });
});

describe("generateInternalLinkRecommendations", () => {
  it("calls generateStructuredOutput with taskType INTERNAL_LINK_ANALYSIS and the current PROMPT_VERSION", async () => {
    mockGenerate.mockResolvedValue({ recommendations: [VALID_REC] });
    await generateInternalLinkRecommendations(BASE_CTX);
    const [, options] = mockGenerate.mock.calls[0];
    expect(options.taskType).toBe("INTERNAL_LINK_ANALYSIS");
    expect(options.promptVersion).toBe(PROMPT_VERSION);
    expect(options.seoProjectId).toBe("project-1");
    expect(options.companyId).toBe("company-1");
  });

  it("fetches the Brand Profile by ctx.companyId", async () => {
    mockGenerate.mockResolvedValue({ recommendations: [] });
    await generateInternalLinkRecommendations(BASE_CTX);
    expect(mockGetBrandProfile).toHaveBeenCalledWith("company-1");
  });

  it("uses the streaming orchestrator when onChunk is supplied, not the non-streaming one", async () => {
    mockGenerateStreaming.mockResolvedValue({ recommendations: [] });
    const onChunk = vi.fn();
    await generateInternalLinkRecommendations(BASE_CTX, onChunk);
    expect(mockGenerateStreaming).toHaveBeenCalledTimes(1);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("applies the same deterministic target-page cross-check to the live provider response, dropping a fabricated target", async () => {
    const fabricated = { ...VALID_REC, targetPage: "https://fabricated.example.com/made-up-page" };
    mockGenerate.mockResolvedValue({ recommendations: [VALID_REC, fabricated] });
    const result = await generateInternalLinkRecommendations(BASE_CTX);
    expect(result).toEqual([VALID_REC]);
  });

  it("defaults to an empty array when the model omits the recommendations field", async () => {
    mockGenerate.mockResolvedValue({});
    const result = await generateInternalLinkRecommendations(BASE_CTX);
    expect(result).toEqual([]);
  });
});
