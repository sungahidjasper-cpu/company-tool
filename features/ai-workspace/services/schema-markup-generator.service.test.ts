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
import { buildPrompt, generateSchemaMarkupRecommendations, isValidJsonLd, PROMPT_VERSION, SCHEMA_MARKUP_SYSTEM_PROMPT, type SchemaMarkupContext } from "@/features/ai-workspace/services/schema-markup-generator.service";

const mockGenerate = vi.mocked(generateStructuredOutput);
const mockGenerateStreaming = vi.mocked(generateStructuredOutputStreaming);
const mockGetBrandProfile = vi.mocked(getBrandProfileByCompanyId);

beforeEach(() => {
  mockGenerate.mockReset();
  mockGenerateStreaming.mockReset();
  mockGetBrandProfile.mockReset();
  mockGetBrandProfile.mockResolvedValue(null);
});

const BASE_CTX: SchemaMarkupContext = {
  seoProjectId: "project-1",
  companyId: "company-1",
  seoProjectName: "Acme Plumbing",
  domain: "acme-plumbing.example.com",
};

const VALID_JSON_LD = '{"@context":"https://schema.org","@type":"LocalBusiness","name":"Acme Plumbing"}';
const RESULT = { recommendations: [{ schemaType: "LocalBusiness", reasoning: "It's a local service business.", exampleJsonLd: VALID_JSON_LD }] };

describe("buildPrompt", () => {
  it("states no specific page was selected when ctx.content is absent", () => {
    const prompt = buildPrompt(BASE_CTX);
    expect(prompt).toContain("No specific existing page was selected");
  });

  it("includes the target page's title, url, and description when ctx.content is present", () => {
    const prompt = buildPrompt({ ...BASE_CTX, content: { title: "Emergency Plumbing", metaDescription: "24/7 emergency plumbing.", url: "https://acme-plumbing.example.com/emergency" } });
    expect(prompt).toContain('Target page: "Emergency Plumbing" (https://acme-plumbing.example.com/emergency)');
    expect(prompt).toContain("Page description: 24/7 emergency plumbing.");
  });

  it("instructs the model that exampleJsonLd must be an actual serialized object, not a bare URL or description", () => {
    const prompt = buildPrompt(BASE_CTX);
    expect(prompt).toContain("It must NEVER be a bare URL, a comment, or a sentence describing what the JSON-LD would contain");
    expect(prompt).toContain('{"@context":"https://schema.org"');
  });

  it("includes the requester's notes when supplied", () => {
    const prompt = buildPrompt({ ...BASE_CTX, notes: "single physical location" });
    expect(prompt).toContain("Additional context from the requester: single physical location");
  });

  it("omits every Brand Profile line when no Brand Profile is supplied", () => {
    const prompt = buildPrompt(BASE_CTX, null);
    expect(prompt).not.toContain("Brand name:");
    expect(prompt).not.toContain("Products/services:");
    expect(prompt).not.toContain("Target audience:");
    expect(prompt).not.toContain("Target country/market:");
  });

  it("includes Brand Profile fields when supplied", () => {
    const prompt = buildPrompt(BASE_CTX, {
      id: "profile-1",
      companyId: "company-1",
      brandName: "Acme Plumbing Co",
      brandVoice: null,
      targetAudience: "Homeowners",
      productsServices: "Emergency plumbing repair",
      targetCountry: "United States",
      language: null,
      competitorUrls: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    expect(prompt).toContain("Brand name: Acme Plumbing Co.");
    expect(prompt).toContain("Products/services: Emergency plumbing repair.");
    expect(prompt).toContain("Target audience: Homeowners.");
    expect(prompt).toContain("Target country/market: United States.");
  });

  it("[STEP 10] allows zero recommendations and tells the model fewer/none is an acceptable answer", () => {
    const prompt = buildPrompt(BASE_CTX);
    expect(prompt).toContain("fewer is fine, and zero is an acceptable answer if nothing above is well-supported enough");
  });

  it("[STEP 10] instructs the model to remove a recommendation or field it cannot justify against the supplied information, rather than guessing", () => {
    const prompt = buildPrompt(BASE_CTX);
    expect(prompt).toContain("Before finalizing, re-check every recommendation against the information above");
    expect(prompt).toContain("remove that recommendation or that field rather than guessing");
  });
});

describe("[STEP 10] SCHEMA_MARKUP_SYSTEM_PROMPT — anti-fabrication and evidence-only instructions", () => {
  it("requires specific evidence for a schema type and instructs omitting it when evidence is insufficient", () => {
    expect(SCHEMA_MARKUP_SYSTEM_PROMPT).toContain("Recommend a schema type ONLY when the supplied context contains specific evidence supporting it");
    expect(SCHEMA_MARKUP_SYSTEM_PROMPT).toContain("If the evidence for a type is insufficient, OMIT that type entirely");
  });

  it("forbids recommending a type merely because it could theoretically help SEO or because similar businesses often use it", () => {
    expect(SCHEMA_MARKUP_SYSTEM_PROMPT).toContain("because it could theoretically help SEO");
    expect(SCHEMA_MARKUP_SYSTEM_PROMPT).toContain("Never recommend a type merely because businesses of this general kind often use it");
  });

  it("names the specific per-type evidence requirements audited in STEP 9 (Product, LocalBusiness, FAQPage, Article, Organization)", () => {
    expect(SCHEMA_MARKUP_SYSTEM_PROMPT).toContain("never recommend Product unless the supplied context identifies an actual, named product or service");
    expect(SCHEMA_MARKUP_SYSTEM_PROMPT).toContain("never recommend LocalBusiness unless the supplied context provides real business/location evidence");
    expect(SCHEMA_MARKUP_SYSTEM_PROMPT).toContain("never recommend FAQPage unless actual question-and-answer content is present");
    expect(SCHEMA_MARKUP_SYSTEM_PROMPT).toContain("never recommend Article unless the supplied page is actually an article");
    expect(SCHEMA_MARKUP_SYSTEM_PROMPT).toContain("never default to Organization as a generic fallback");
  });

  it("extends the never-invent list beyond ratings/reviews/prices to entities, products, authors, dates, and business/organization details", () => {
    expect(SCHEMA_MARKUP_SYSTEM_PROMPT).toContain(
      "Never invent a product, service, entity, author, publisher, date, price, rating, review, testimonial, certification, award, location, URL, organization detail, business detail, or any other factual value"
    );
  });

  it("forbids placeholder values that could be mistaken for real production data, while allowing the already-supplied real domain as a url", () => {
    expect(SCHEMA_MARKUP_SYSTEM_PROMPT).toContain("Never fill a required-looking field with a placeholder that could be mistaken for real production data");
    expect(SCHEMA_MARKUP_SYSTEM_PROMPT).toContain("the supplied website domain may be used as an entity's url");
  });

  it("bans speculative reasoning phrasing and frames it as a signal the recommendation should be omitted", () => {
    for (const phrase of ['"may contain,"', '"is likely to,"', '"could potentially,"', '"might have."']) {
      expect(SCHEMA_MARKUP_SYSTEM_PROMPT).toContain(phrase);
    }
    expect(SCHEMA_MARKUP_SYSTEM_PROMPT).toContain("that is a sign the evidence is insufficient and the recommendation should be omitted instead");
  });
});

describe("isValidJsonLd", () => {
  it("1. accepts a valid JSON-LD object with @context and @type", () => {
    expect(isValidJsonLd('{"@context":"https://schema.org","@type":"Organization","name":"Acme"}')).toBe(true);
  });

  it("2. rejects a bare URL", () => {
    expect(isValidJsonLd("https://example.com/storagemoguls-organization.json")).toBe(false);
  });

  it("3. rejects a URL with a trailing comment fragment (the exact live-observed defect shape)", () => {
    expect(isValidJsonLd("https://www.storagemoguls.com/ # Storage Moguls Self Storage")).toBe(false);
  });

  it("4. rejects a markdown-fenced JSON block rather than stripping the fence", () => {
    expect(isValidJsonLd('```json\n{"@context":"https://schema.org","@type":"Organization"}\n```')).toBe(false);
  });

  it("5. rejects plain explanatory prose", () => {
    expect(isValidJsonLd("This would be an Organization schema with the business name and URL.")).toBe(false);
  });

  it("6. rejects truncated JSON (the exact live-observed defect shape)", () => {
    expect(isValidJsonLd("{")).toBe(false);
    expect(isValidJsonLd(' {"@context": "https://schema.org", "@type": "Organization", "name": "Storage Moguls", "url": "https://www.storagemoguls.com/')).toBe(false);
  });

  it("7. rejects an empty string", () => {
    expect(isValidJsonLd("")).toBe(false);
    expect(isValidJsonLd("   ")).toBe(false);
  });

  it("8. rejects a JSON primitive, string, or array — the contract requires an object", () => {
    expect(isValidJsonLd("42")).toBe(false);
    expect(isValidJsonLd('"just a quoted string"')).toBe(false);
    expect(isValidJsonLd('["@context", "@type"]')).toBe(false);
    expect(isValidJsonLd("null")).toBe(false);
  });

  it("9. rejects a well-formed JSON object missing @context", () => {
    expect(isValidJsonLd('{"@type":"Organization","name":"Acme"}')).toBe(false);
  });

  it("10. rejects a well-formed JSON object missing @type", () => {
    expect(isValidJsonLd('{"@context":"https://schema.org","name":"Acme"}')).toBe(false);
  });

  it("11. does not repair or mutate — a near-miss (single quotes instead of double) is rejected outright, never coerced", () => {
    expect(isValidJsonLd("{'@context':'https://schema.org','@type':'Organization'}")).toBe(false);
  });
});

describe("generateSchemaMarkupRecommendations", () => {
  it("calls generateStructuredOutput with taskType SCHEMA_MARKUP_GENERATION and the current PROMPT_VERSION", async () => {
    mockGenerate.mockResolvedValue(RESULT);
    await generateSchemaMarkupRecommendations(BASE_CTX);
    const [, options] = mockGenerate.mock.calls[0];
    expect(options.taskType).toBe("SCHEMA_MARKUP_GENERATION");
    expect(options.promptVersion).toBe(PROMPT_VERSION);
    expect(options.seoProjectId).toBe("project-1");
    expect(options.companyId).toBe("company-1");
  });

  it("fetches the Brand Profile by ctx.companyId", async () => {
    mockGenerate.mockResolvedValue(RESULT);
    await generateSchemaMarkupRecommendations(BASE_CTX);
    expect(mockGetBrandProfile).toHaveBeenCalledWith("company-1");
  });

  it("uses the streaming orchestrator when onChunk is supplied, not the non-streaming one", async () => {
    mockGenerateStreaming.mockResolvedValue(RESULT);
    const onChunk = vi.fn();
    await generateSchemaMarkupRecommendations(BASE_CTX, onChunk);
    expect(mockGenerateStreaming).toHaveBeenCalledTimes(1);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("returns a valid recommendation unchanged", async () => {
    mockGenerate.mockResolvedValue(RESULT);
    const result = await generateSchemaMarkupRecommendations(BASE_CTX);
    expect(result.recommendations).toEqual(RESULT.recommendations);
  });

  it("defaults recommendations to an empty array when the model omits the field", async () => {
    mockGenerate.mockResolvedValue({});
    const result = await generateSchemaMarkupRecommendations(BASE_CTX);
    expect(result.recommendations).toEqual([]);
  });

  it("[STEP 10] 12. filters out a recommendation with malformed exampleJsonLd rather than returning it as copy-ready", async () => {
    mockGenerate.mockResolvedValue({
      recommendations: [{ schemaType: "Organization", reasoning: "This is a business.", exampleJsonLd: "https://example.com/your-page-url }" }],
    });
    const result = await generateSchemaMarkupRecommendations(BASE_CTX);
    expect(result.recommendations).toEqual([]);
  });

  it("[STEP 10] 13. keeps valid recommendations while dropping only the invalid ones in the same response", async () => {
    const validRec = { schemaType: "LocalBusiness", reasoning: "Real evidence.", exampleJsonLd: VALID_JSON_LD };
    const invalidRec = { schemaType: "Product", reasoning: "Speculative.", exampleJsonLd: "{" };
    mockGenerate.mockResolvedValue({ recommendations: [validRec, invalidRec] });
    const result = await generateSchemaMarkupRecommendations(BASE_CTX);
    expect(result.recommendations).toEqual([validRec]);
  });

  it("[STEP 10] 14. regression — the exact live-observed malformed shapes (bare URL, URL+comment, truncated brace) never reach the result even across a full multi-recommendation response", async () => {
    mockGenerate.mockResolvedValue({
      recommendations: [
        { schemaType: "Organization", reasoning: "The page is a business overview.", exampleJsonLd: "https://example.com/storagemoguls-organization.json" },
        { schemaType: "LocalBusiness", reasoning: "Likely located in a specific area.", exampleJsonLd: "https://www.storagemoguls.com/ # Storage Moguls Self Storage" },
        { schemaType: "Product", reasoning: "May offer storage-related products.", exampleJsonLd: "{" },
        { schemaType: "FAQPage", reasoning: "Could potentially have FAQs.", exampleJsonLd: VALID_JSON_LD },
      ],
    });
    const result = await generateSchemaMarkupRecommendations(BASE_CTX);
    expect(result.recommendations).toEqual([{ schemaType: "FAQPage", reasoning: "Could potentially have FAQs.", exampleJsonLd: VALID_JSON_LD }]);
  });
});
