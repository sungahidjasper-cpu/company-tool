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
import {
  buildPressReleaseResult,
  buildPrompt,
  generatePressRelease,
  PRESS_RELEASE_GENERATOR_SYSTEM_PROMPT,
  PROMPT_VERSION,
  type PressReleaseGeneratorContext,
} from "@/features/ai-workspace/services/press-release-generator.service";

const mockGenerate = vi.mocked(generateStructuredOutput);
const mockGenerateStreaming = vi.mocked(generateStructuredOutputStreaming);
const mockGetBrandProfile = vi.mocked(getBrandProfileByCompanyId);

beforeEach(() => {
  mockGenerate.mockReset();
  mockGenerateStreaming.mockReset();
  mockGetBrandProfile.mockReset();
  mockGetBrandProfile.mockResolvedValue(null);
});

const BASE_CTX: PressReleaseGeneratorContext = {
  seoProjectId: "project-1",
  companyId: "company-1",
  seoProjectName: "Acme Plumbing",
  domain: "acme-plumbing.example.com",
  headline: "Acme Plumbing Launches 24/7 Emergency Line",
  keyFacts: "Acme Plumbing is launching a new 24/7 emergency dispatch line starting March 1st, covering the greater Austin area.",
};

const VALID_RAW = {
  headline: "Acme Plumbing Launches 24/7 Emergency Dispatch Line",
  subheadline: "New service begins March 1st across the Austin area",
  dateline: "",
  leadParagraph: "Acme Plumbing today announced a new 24/7 emergency dispatch line launching March 1st.",
  bodyParagraphs: ["The new line will cover the greater Austin area, giving customers round-the-clock access to emergency plumbing help."],
  quoteSection: "",
  boilerplate: "Acme Plumbing provides residential and commercial plumbing services.",
  callToAction: "",
  reasoning: "Structured as a standard launch announcement using only the supplied facts.",
};

describe("buildPrompt", () => {
  it("includes the headline and key facts verbatim", () => {
    const prompt = buildPrompt(BASE_CTX);
    expect(prompt).toContain('Announcement headline: "Acme Plumbing Launches 24/7 Emergency Line"');
    expect(prompt).toContain(BASE_CTX.keyFacts);
  });

  it("states explicitly not to invent a quote/dateline/CTA when none was supplied", () => {
    const prompt = buildPrompt(BASE_CTX);
    expect(prompt).toContain("do not invent a quote; leave quoteSection empty");
    expect(prompt).toContain("do not guess one; leave dateline empty");
    expect(prompt).toContain("leave callToAction empty");
  });

  it("includes the supplied quote/dateline/callToAction verbatim when present", () => {
    const prompt = buildPrompt({ ...BASE_CTX, quote: '"Great news" - Jane Doe, CEO', dateline: "Austin, TX", callToAction: "Visit acme.example.com" });
    expect(prompt).toContain('Quote to include, attributed exactly as given: ""Great news" - Jane Doe, CEO"');
    expect(prompt).toContain('Dateline/location: "Austin, TX"');
    expect(prompt).toContain('Call to action / contact info to close with: "Visit acme.example.com"');
  });

  it("includes optional notes only when supplied", () => {
    const withoutNotes = buildPrompt(BASE_CTX);
    expect(withoutNotes).not.toContain("Additional notes:");
    const withNotes = buildPrompt({ ...BASE_CTX, notes: "Keep it under 200 words." });
    expect(withNotes).toContain("Additional notes: Keep it under 200 words.");
  });

  it("includes Brand Profile fields when supplied, as supplementary context only", () => {
    const prompt = buildPrompt(BASE_CTX, {
      brandName: "Acme Plumbing Co",
      brandVoice: "friendly and direct",
      targetAudience: "homeowners",
      productsServices: "residential plumbing repair",
      targetCountry: "United States",
      language: "English",
    } as never);
    expect(prompt).toContain("Brand name: Acme Plumbing Co.");
    expect(prompt).toContain("Brand voice: friendly and direct.");
    expect(prompt).toContain("Target audience: homeowners.");
    expect(prompt).toContain("Products/services: residential plumbing repair.");
    expect(prompt).toContain("Target country/market: United States.");
    expect(prompt).toContain("Write in this language: English.");
  });

  it("omits Brand Profile lines entirely when no profile is supplied", () => {
    const prompt = buildPrompt(BASE_CTX, null);
    expect(prompt).not.toContain("Brand name:");
    expect(prompt).not.toContain("Products/services:");
  });

  it("asks for exactly the nine output fields", () => {
    const prompt = buildPrompt(BASE_CTX);
    for (const field of ["headline", "subheadline", "dateline", "leadParagraph", "bodyParagraphs", "quoteSection", "boilerplate", "callToAction", "reasoning"]) {
      expect(prompt).toContain(field);
    }
  });
});

describe("PRESS_RELEASE_GENERATOR_SYSTEM_PROMPT", () => {
  it("forbids inventing dates, names, companies, partners, customers, awards, statistics, locations, product claims, partnerships, testimonials, or quotes", () => {
    expect(PRESS_RELEASE_GENERATOR_SYSTEM_PROMPT).toMatch(/never invent a date, named person, company, partner, customer, award, certification, statistic, location, product capability, partnership, testimonial, or quote/i);
  });

  it("requires a supplied quote to be attributed exactly as given, never paraphrased", () => {
    expect(PRESS_RELEASE_GENERATOR_SYSTEM_PROMPT).toMatch(/never paraphrased/i);
  });

  it("restricts the boilerplate to Brand Profile context only", () => {
    expect(PRESS_RELEASE_GENERATOR_SYSTEM_PROMPT).toMatch(/never invent products, services, achievements, or history not stated there/i);
  });
});

describe("buildPressReleaseResult — deterministic validation", () => {
  it("1. a valid release returns a fully populated result", () => {
    const result = buildPressReleaseResult(VALID_RAW, BASE_CTX);
    expect(result).not.toBeNull();
    expect(result?.headline).toBe(VALID_RAW.headline);
    expect(result?.bodyParagraphs).toEqual(VALID_RAW.bodyParagraphs);
  });

  it("2. rejects a non-object raw value", () => {
    expect(buildPressReleaseResult(null, BASE_CTX)).toBeNull();
    expect(buildPressReleaseResult("a string", BASE_CTX)).toBeNull();
    expect(buildPressReleaseResult(42, BASE_CTX)).toBeNull();
  });

  it("3. rejects when a required field has the wrong type", () => {
    expect(buildPressReleaseResult({ ...VALID_RAW, headline: 123 }, BASE_CTX)).toBeNull();
    expect(buildPressReleaseResult({ ...VALID_RAW, bodyParagraphs: "not an array" }, BASE_CTX)).toBeNull();
    expect(buildPressReleaseResult({ ...VALID_RAW, bodyParagraphs: [1, 2] }, BASE_CTX)).toBeNull();
  });

  it("4. rejects a missing or empty reasoning", () => {
    expect(buildPressReleaseResult({ ...VALID_RAW, reasoning: "" }, BASE_CTX)).toBeNull();
    expect(buildPressReleaseResult({ ...VALID_RAW, reasoning: "   " }, BASE_CTX)).toBeNull();
    const withoutReasoning: Record<string, unknown> = { ...VALID_RAW };
    delete withoutReasoning.reasoning;
    expect(buildPressReleaseResult(withoutReasoning, BASE_CTX)).toBeNull();
  });

  it("5. rejects when the headline is empty after cleaning", () => {
    expect(buildPressReleaseResult({ ...VALID_RAW, headline: "   " }, BASE_CTX)).toBeNull();
  });

  it("6. rejects when the lead paragraph is empty after cleaning", () => {
    expect(buildPressReleaseResult({ ...VALID_RAW, leadParagraph: "" }, BASE_CTX)).toBeNull();
  });

  it("7. rejects when the boilerplate is empty after cleaning", () => {
    expect(buildPressReleaseResult({ ...VALID_RAW, boilerplate: "" }, BASE_CTX)).toBeNull();
  });

  it("8. rejects when bodyParagraphs is empty (or becomes empty after cleaning)", () => {
    expect(buildPressReleaseResult({ ...VALID_RAW, bodyParagraphs: [] }, BASE_CTX)).toBeNull();
    expect(buildPressReleaseResult({ ...VALID_RAW, bodyParagraphs: ["   ", ""] }, BASE_CTX)).toBeNull();
  });

  it("9. does NOT reject when subheadline/dateline/quoteSection/callToAction are legitimately empty", () => {
    const result = buildPressReleaseResult(VALID_RAW, BASE_CTX);
    expect(result).not.toBeNull();
    expect(result?.dateline).toBe("");
    expect(result?.quoteSection).toBe("");
    expect(result?.callToAction).toBe("");
  });

  it("10. strips a leaked trailing configuration artifact from the headline without rejecting it", () => {
    const result = buildPressReleaseResult({ ...VALID_RAW, headline: `${VALID_RAW.headline} | 1500 words` }, BASE_CTX);
    expect(result).not.toBeNull();
    expect(result?.headline).toBe(VALID_RAW.headline);
  });

  it("11. strips an HTML tag from the headline", () => {
    const result = buildPressReleaseResult({ ...VALID_RAW, headline: `<b>${VALID_RAW.headline}</b>` }, BASE_CTX);
    expect(result?.headline).toBe(VALID_RAW.headline);
  });

  it("12. rejects an instruction-echoed headline", () => {
    expect(buildPressReleaseResult({ ...VALID_RAW, headline: "meta title: something" }, BASE_CTX)).toBeNull();
  });

  it("13. rejects an instruction-echoed body paragraph", () => {
    expect(buildPressReleaseResult({ ...VALID_RAW, bodyParagraphs: ["150 words, 900 characters"] }, BASE_CTX)).toBeNull();
  });

  it("14. clears a fabricated quoteSection to empty when the user supplied no quote — never rejects the whole release for this", () => {
    const result = buildPressReleaseResult({ ...VALID_RAW, quoteSection: '"This is amazing," said a fabricated spokesperson.' }, BASE_CTX);
    expect(result).not.toBeNull();
    expect(result?.quoteSection).toBe("");
  });

  it("15. clears a fabricated dateline to empty when the user supplied none", () => {
    const result = buildPressReleaseResult({ ...VALID_RAW, dateline: "SAN FRANCISCO, CA" }, BASE_CTX);
    expect(result).not.toBeNull();
    expect(result?.dateline).toBe("");
  });

  it("16. clears a fabricated callToAction to empty when the user supplied none", () => {
    const result = buildPressReleaseResult({ ...VALID_RAW, callToAction: "Call us at 555-0100" }, BASE_CTX);
    expect(result).not.toBeNull();
    expect(result?.callToAction).toBe("");
  });

  it("17. preserves a real quoteSection when the user DID supply a quote", () => {
    const ctxWithQuote = { ...BASE_CTX, quote: '"We are excited" - Jane Doe' };
    const result = buildPressReleaseResult({ ...VALID_RAW, quoteSection: '"We are excited," said Jane Doe, CEO of Acme Plumbing.' }, ctxWithQuote);
    expect(result?.quoteSection).toBe('"We are excited," said Jane Doe, CEO of Acme Plumbing.');
  });

  it("18. preserves a real dateline when the user DID supply one", () => {
    const ctxWithDateline = { ...BASE_CTX, dateline: "Austin, TX" };
    const result = buildPressReleaseResult({ ...VALID_RAW, dateline: "AUSTIN, TX" }, ctxWithDateline);
    expect(result?.dateline).toBe("AUSTIN, TX");
  });

  it("19. preserves a real callToAction when the user DID supply one", () => {
    const ctxWithCta = { ...BASE_CTX, callToAction: "Visit acme.example.com" };
    const result = buildPressReleaseResult({ ...VALID_RAW, callToAction: "Visit acme.example.com to learn more." }, ctxWithCta);
    expect(result?.callToAction).toBe("Visit acme.example.com to learn more.");
  });

  it("20. rejects an instruction-echoed quoteSection even when a real quote was supplied", () => {
    const ctxWithQuote = { ...BASE_CTX, quote: "some quote" };
    expect(buildPressReleaseResult({ ...VALID_RAW, quoteSection: "meta description:" }, ctxWithQuote)).toBeNull();
  });
});

describe("generatePressRelease", () => {
  it("21. calls generateStructuredOutput with taskType PRESS_RELEASE_GENERATION and the current PROMPT_VERSION", async () => {
    mockGenerate.mockResolvedValue(VALID_RAW);
    await generatePressRelease(BASE_CTX);
    expect(mockGenerate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ taskType: "PRESS_RELEASE_GENERATION", promptVersion: PROMPT_VERSION, companyId: "company-1", seoProjectId: "project-1" })
    );
  });

  it("22. uses generateStructuredOutputStreaming instead when an onChunk callback is supplied", async () => {
    mockGenerateStreaming.mockResolvedValue(VALID_RAW);
    const onChunk = vi.fn();
    await generatePressRelease(BASE_CTX, onChunk);
    expect(mockGenerateStreaming).toHaveBeenCalled();
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("23. returns a fully-built PressReleaseResult for a valid provider response", async () => {
    mockGenerate.mockResolvedValue(VALID_RAW);
    const result = await generatePressRelease(BASE_CTX);
    expect(result).not.toBeNull();
    expect(result?.headline).toBe(VALID_RAW.headline);
  });

  it("24. returns null (a successful, empty outcome) when the provider's response is fully invalid — never throws", async () => {
    mockGenerate.mockResolvedValue({ headline: "", subheadline: "", dateline: "", leadParagraph: "", bodyParagraphs: [], quoteSection: "", boilerplate: "", callToAction: "", reasoning: "" });
    const result = await generatePressRelease(BASE_CTX);
    expect(result).toBeNull();
  });

  it("25. fetches Brand Profile using ctx.companyId", async () => {
    mockGenerate.mockResolvedValue(VALID_RAW);
    await generatePressRelease(BASE_CTX);
    expect(mockGetBrandProfile).toHaveBeenCalledWith("company-1");
  });
});
