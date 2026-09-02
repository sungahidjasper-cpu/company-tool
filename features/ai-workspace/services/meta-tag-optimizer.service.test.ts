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
  buildPrompt,
  filterValidSuggestions,
  generateMetaTagSuggestions,
  META_TAG_OPTIMIZER_SYSTEM_PROMPT,
  PROMPT_VERSION,
  type MetaTagInventoryItem,
  type MetaTagOptimizerContext,
} from "@/features/ai-workspace/services/meta-tag-optimizer.service";

const mockGenerate = vi.mocked(generateStructuredOutput);
const mockGenerateStreaming = vi.mocked(generateStructuredOutputStreaming);
const mockGetBrandProfile = vi.mocked(getBrandProfileByCompanyId);

beforeEach(() => {
  mockGenerate.mockReset();
  mockGenerateStreaming.mockReset();
  mockGetBrandProfile.mockReset();
  mockGetBrandProfile.mockResolvedValue(null);
});

const INVENTORY: MetaTagInventoryItem[] = [
  { contentId: "content-1", title: "Emergency Plumbing Guide", url: "https://acme-plumbing.example.com/emergency", currentMetaTitle: "Emergency Plumbing | Acme", currentMetaDescription: "Old description." },
  { contentId: "content-2", title: "Water Heater Repair", url: "https://acme-plumbing.example.com/water-heater", currentMetaTitle: null, currentMetaDescription: null },
];

const BASE_CTX: MetaTagOptimizerContext = {
  seoProjectId: "project-1",
  companyId: "company-1",
  seoProjectName: "Acme Plumbing",
  domain: "acme-plumbing.example.com",
  inventory: INVENTORY,
};

const VALID_TITLE = "Emergency Plumbing Repair in Austin | Acme Plumbing Co";
const VALID_DESCRIPTION = "Burst pipe or no hot water? Acme Plumbing offers 24/7 emergency repair across Austin. Call now for fast, reliable service.";

const VALID_SUGGESTION_1 = { contentId: "content-1", suggestedMetaTitle: VALID_TITLE, suggestedMetaDescription: VALID_DESCRIPTION, reasoning: "Adds location and a clear call to action." };
const VALID_SUGGESTION_2 = {
  contentId: "content-2",
  suggestedMetaTitle: "Water Heater Repair & Installation | Acme Plumbing",
  suggestedMetaDescription: "Fast, licensed water heater repair and installation in Austin. Same-day appointments available from Acme Plumbing.",
  reasoning: "Provides metadata where none existed before.",
};

describe("buildPrompt", () => {
  it("lists every inventory page with its exact contentId, title, url, and current metadata", () => {
    const prompt = buildPrompt(BASE_CTX);
    expect(prompt).toContain("contentId: content-1");
    expect(prompt).toContain('title: "Emergency Plumbing Guide"');
    expect(prompt).toContain("url: https://acme-plumbing.example.com/emergency");
    expect(prompt).toContain('current meta title: "Emergency Plumbing | Acme"');
    expect(prompt).toContain("contentId: content-2");
    expect(prompt).toContain("current meta title: (none set)");
    expect(prompt).toContain("current meta description: (none set)");
  });

  it("states the list is complete and exact, not to be added to or substituted", () => {
    const prompt = buildPrompt(BASE_CTX);
    expect(prompt).toContain("this is the complete, exact list — do not add, remove, or substitute a page");
  });

  it("states the advisory (not hard) length guidance ranges", () => {
    const prompt = buildPrompt(BASE_CTX);
    expect(prompt).toContain("Guidance (not a hard limit): aim for a meta title of roughly 50-60 characters and a meta description of roughly 120-160 characters.");
  });

  it("instructs never to modify a url and to generate exactly one suggestion per page", () => {
    const prompt = buildPrompt(BASE_CTX);
    expect(prompt).toContain("Never modify a page's url");
    expect(prompt).toContain("Generate exactly one suggestion per listed page");
  });

  it("includes Brand Profile fields when supplied, as supplementary context only", () => {
    const prompt = buildPrompt(BASE_CTX, { brandName: "Acme Plumbing Co", brandVoice: "friendly and direct", targetAudience: "homeowners", targetCountry: "United States", language: "English" } as never);
    expect(prompt).toContain("Brand name: Acme Plumbing Co.");
    expect(prompt).toContain("Brand voice: friendly and direct.");
    expect(prompt).toContain("Target audience: homeowners.");
    expect(prompt).toContain("Target country/market: United States.");
    expect(prompt).toContain("Write in this language: English.");
  });

  it("never includes productsServices, even when supplied on the Brand Profile", () => {
    const prompt = buildPrompt(BASE_CTX, { brandName: "Acme Plumbing Co", productsServices: "Emergency plumbing repair" } as never);
    expect(prompt).not.toContain("Products/services");
    expect(prompt).not.toContain("Emergency plumbing repair");
  });

  it("omits Brand Profile lines when none is supplied", () => {
    const prompt = buildPrompt(BASE_CTX, null);
    expect(prompt).not.toContain("Brand name:");
    expect(prompt).not.toContain("Brand voice:");
  });
});

describe("META_TAG_OPTIMIZER_SYSTEM_PROMPT", () => {
  it("establishes the supplied page list as the sole source of truth and forbids inventing a page, url, or contentId", () => {
    expect(META_TAG_OPTIMIZER_SYSTEM_PROMPT).toContain("is the ONLY source of truth for what to optimize");
    expect(META_TAG_OPTIMIZER_SYSTEM_PROMPT).toContain("Never invent a different page, never invent a url, and never invent a contentId");
  });

  it("requires suggested metadata to stay true to the page's actual topic", () => {
    expect(META_TAG_OPTIMIZER_SYSTEM_PROMPT).toContain("never suggest metadata that describes a different subject than the page already covers");
  });

  it("forbids keyword stuffing and unnecessary repetition across suggestions", () => {
    expect(META_TAG_OPTIMIZER_SYSTEM_PROMPT).toContain("avoid keyword stuffing");
    expect(META_TAG_OPTIMIZER_SYSTEM_PROMPT).toContain("never repeat the same phrase across multiple suggestions just to fill space");
  });

  it("forbids unsupported claims and instruction-like text in the visible output", () => {
    expect(META_TAG_OPTIMIZER_SYSTEM_PROMPT).toContain("Never state a fact, statistic, offer, or claim that isn't already supported by the page's own title or current metadata");
    expect(META_TAG_OPTIMIZER_SYSTEM_PROMPT).toContain("Never include instruction text, configuration labels, or a character count");
  });
});

describe("filterValidSuggestions", () => {
  it("1. accepts a well-formed suggestion whose contentId is in the supplied inventory", () => {
    const [result] = filterValidSuggestions([VALID_SUGGESTION_1], INVENTORY);
    expect(result).toMatchObject({
      contentId: "content-1",
      url: "https://acme-plumbing.example.com/emergency",
      currentMetaTitle: "Emergency Plumbing | Acme",
      suggestedMetaTitle: VALID_TITLE,
      currentMetaDescription: "Old description.",
      suggestedMetaDescription: VALID_DESCRIPTION,
      reasoning: "Adds location and a clear call to action.",
    });
  });

  it("2. rejects a suggestion whose contentId is a fabricated id not in the inventory", () => {
    const fabricated = { ...VALID_SUGGESTION_1, contentId: "content-does-not-exist" };
    expect(filterValidSuggestions([fabricated], INVENTORY)).toEqual([]);
  });

  it("3. rejects a duplicate suggestion for a contentId already accepted, keeping only the first", () => {
    const secondForSameId = { ...VALID_SUGGESTION_1, suggestedMetaTitle: "A different title for the same page" };
    const result = filterValidSuggestions([VALID_SUGGESTION_1, secondForSameId], INVENTORY);
    expect(result).toHaveLength(1);
    expect(result[0].suggestedMetaTitle).toBe(VALID_TITLE);
  });

  it("4. rejects a suggestion with an empty suggestedMetaTitle", () => {
    expect(filterValidSuggestions([{ ...VALID_SUGGESTION_1, suggestedMetaTitle: "" }], INVENTORY)).toEqual([]);
    expect(filterValidSuggestions([{ ...VALID_SUGGESTION_1, suggestedMetaTitle: "   " }], INVENTORY)).toEqual([]);
  });

  it("5. rejects a suggestion with an empty suggestedMetaDescription", () => {
    expect(filterValidSuggestions([{ ...VALID_SUGGESTION_1, suggestedMetaDescription: "" }], INVENTORY)).toEqual([]);
    expect(filterValidSuggestions([{ ...VALID_SUGGESTION_1, suggestedMetaDescription: "   " }], INVENTORY)).toEqual([]);
  });

  it("6. rejects a structurally malformed item without discarding the other, valid items in the same batch", () => {
    const malformed = ["just a string", null, { contentId: "content-1" }];
    const result = filterValidSuggestions([...malformed, VALID_SUGGESTION_1], INVENTORY);
    expect(result).toEqual([expect.objectContaining({ contentId: "content-1" })]);
  });

  it("7. rejects a suggestion whose title or description is instruction-echoed text", () => {
    const echoedTitle = { ...VALID_SUGGESTION_1, suggestedMetaTitle: "meta title: EXACTLY 50-60 characters total" };
    const echoedDescription = { ...VALID_SUGGESTION_2, suggestedMetaDescription: "meta description: 155 words, 160 characters" };
    expect(filterValidSuggestions([echoedTitle], INVENTORY)).toEqual([]);
    expect(filterValidSuggestions([echoedDescription], INVENTORY)).toEqual([]);
  });

  it("8. strips HTML tags and configuration artifacts from accepted text rather than rejecting the whole suggestion for containing them", () => {
    const withArtifacts = { ...VALID_SUGGESTION_1, suggestedMetaTitle: `<b>${VALID_TITLE}</b> | 1500 words` };
    const [result] = filterValidSuggestions([withArtifacts], INVENTORY);
    expect(result.suggestedMetaTitle).toBe(VALID_TITLE);
  });

  it("8b. rejects a suggestion whose text is ENTIRELY artifacts, leaving nothing after sanitization", () => {
    const onlyArtifacts = { ...VALID_SUGGESTION_1, suggestedMetaTitle: "<b></b>" };
    expect(filterValidSuggestions([onlyArtifacts], INVENTORY)).toEqual([]);
  });

  it("9. does NOT reject a suggestion solely because its length falls outside the 50-60 / 120-160 advisory guidance", () => {
    const shortTitle = { ...VALID_SUGGESTION_1, suggestedMetaTitle: "Short" };
    const longDescription = { ...VALID_SUGGESTION_1, suggestedMetaDescription: "A".repeat(300) };
    const [resultA] = filterValidSuggestions([shortTitle], INVENTORY);
    const [resultB] = filterValidSuggestions([longDescription], INVENTORY);
    expect(resultA).toBeDefined();
    expect(resultA.titleLengthGuidance.status).toBe("TOO_SHORT");
    expect(resultB).toBeDefined();
    expect(resultB.descriptionLengthGuidance.status).toBe("TOO_LONG");
  });

  it("9b. reports OK guidance status for a suggestion within the advisory ranges", () => {
    const [result] = filterValidSuggestions([VALID_SUGGESTION_1], INVENTORY);
    expect(result.titleLengthGuidance).toMatchObject({ min: 50, max: 60, status: "OK" });
    expect(result.descriptionLengthGuidance).toMatchObject({ min: 120, max: 160, status: "OK" });
  });

  it("10. preserves every valid suggestion in a multi-content response", () => {
    const result = filterValidSuggestions([VALID_SUGGESTION_1, VALID_SUGGESTION_2], INVENTORY);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.contentId).sort()).toEqual(["content-1", "content-2"]);
  });

  it("11. never expands the supplied inventory — a real second inventory item is still rejected if the AI's contentId for it doesn't match exactly", () => {
    const wrongIdForRealPage = { ...VALID_SUGGESTION_2, contentId: "content-2-typo" };
    const result = filterValidSuggestions([VALID_SUGGESTION_1, wrongIdForRealPage], INVENTORY);
    expect(result).toHaveLength(1);
    expect(result[0].contentId).toBe("content-1");
  });

  it("12. never truncates accepted text — the output is character-for-character identical to the sanitized input, even far outside guidance", () => {
    const longTitle = "A".repeat(120);
    const [result] = filterValidSuggestions([{ ...VALID_SUGGESTION_1, suggestedMetaTitle: longTitle }], INVENTORY);
    expect(result.suggestedMetaTitle).toBe(longTitle);
    expect(result.suggestedMetaTitle.length).toBe(120);
  });

  it("13. never invents fallback metadata for a rejected suggestion — it is simply absent from the result, not replaced with a placeholder", () => {
    const rejected = { ...VALID_SUGGESTION_1, contentId: "content-does-not-exist" };
    const result = filterValidSuggestions([rejected], INVENTORY);
    expect(result.find((r) => r.suggestedMetaTitle === VALID_TITLE)).toBeUndefined();
    expect(result).toEqual([]);
  });

  it("returns an empty array, not an error, when every suggestion is invalid", () => {
    expect(filterValidSuggestions([{ contentId: "nope", suggestedMetaTitle: "x", suggestedMetaDescription: "y", reasoning: "z" }], INVENTORY)).toEqual([]);
  });

  it("returns an empty array unchanged for empty input", () => {
    expect(filterValidSuggestions([], INVENTORY)).toEqual([]);
  });

  it("rejects a suggestion with a missing or empty reasoning field", () => {
    expect(filterValidSuggestions([{ ...VALID_SUGGESTION_1, reasoning: "" }], INVENTORY)).toEqual([]);
    const withoutReasoning = { contentId: VALID_SUGGESTION_1.contentId, suggestedMetaTitle: VALID_SUGGESTION_1.suggestedMetaTitle, suggestedMetaDescription: VALID_SUGGESTION_1.suggestedMetaDescription };
    expect(filterValidSuggestions([withoutReasoning], INVENTORY)).toEqual([]);
  });
});

/**
 * Hardening — discovered live: the AI can return a suggestion
 * byte-identical to the current metadata while its own `reasoning` still
 * claims a change was made. titleChanged/descriptionChanged must be a real
 * deterministic string comparison, completely independent of whatever the
 * reasoning text says — these tests deliberately pair "changed" reasoning
 * text with unchanged values (and vice versa) to prove the flags are never
 * derived from the narrative.
 */
describe("filterValidSuggestions — deterministic change detection", () => {
  it("title changed + description changed: both flags true", () => {
    const suggestion = {
      contentId: "content-1",
      suggestedMetaTitle: "A genuinely different title",
      suggestedMetaDescription: "A genuinely different description.",
      reasoning: "Rewrote both for clarity.",
    };
    const [result] = filterValidSuggestions([suggestion], INVENTORY);
    expect(result.titleChanged).toBe(true);
    expect(result.descriptionChanged).toBe(true);
  });

  it("title unchanged + description changed: titleChanged false, descriptionChanged true — even though the reasoning falsely claims the title changed too", () => {
    const suggestion = {
      contentId: "content-1",
      suggestedMetaTitle: INVENTORY[0].currentMetaTitle, // byte-identical to current
      suggestedMetaDescription: "A genuinely different description.",
      reasoning: "Shortened the title and rewrote the description for clarity.",
    };
    const [result] = filterValidSuggestions([suggestion], INVENTORY);
    expect(result.titleChanged).toBe(false);
    expect(result.descriptionChanged).toBe(true);
  });

  it("title changed + description unchanged: titleChanged true, descriptionChanged false — even though the reasoning falsely claims the description changed", () => {
    const suggestion = {
      contentId: "content-1",
      suggestedMetaTitle: "A genuinely different title",
      suggestedMetaDescription: INVENTORY[0].currentMetaDescription, // byte-identical to current
      reasoning: "Improved the meta description by adding more detail and a call-to-action.",
    };
    const [result] = filterValidSuggestions([suggestion], INVENTORY);
    expect(result.titleChanged).toBe(true);
    expect(result.descriptionChanged).toBe(false);
  });

  it("title unchanged + description unchanged: both flags false — reproduces the exact live defect (identical text, reasoning claims a change)", () => {
    const suggestion = {
      contentId: "content-1",
      suggestedMetaTitle: INVENTORY[0].currentMetaTitle,
      suggestedMetaDescription: INVENTORY[0].currentMetaDescription,
      reasoning: "I changed the meta description to focus on maximizing returns and minimizing risks, providing a more detailed and informative explanation.",
    };
    const [result] = filterValidSuggestions([suggestion], INVENTORY);
    expect(result.titleChanged).toBe(false);
    expect(result.descriptionChanged).toBe(false);
    // The suggestion itself is still returned — an unchanged field is never a rejection reason.
    expect(result.suggestedMetaTitle).toBe(INVENTORY[0].currentMetaTitle);
    expect(result.suggestedMetaDescription).toBe(INVENTORY[0].currentMetaDescription);
  });

  it("null current title/description: a real generated value is always \"changed\", with no special-casing needed", () => {
    const suggestion = {
      contentId: "content-2", // INVENTORY[1] has null currentMetaTitle/currentMetaDescription
      suggestedMetaTitle: "Water Heater Repair & Installation | Acme Plumbing",
      suggestedMetaDescription: "Fast, licensed water heater repair and installation in Austin.",
      reasoning: "Provides metadata where none existed before.",
    };
    const [result] = filterValidSuggestions([suggestion], INVENTORY);
    expect(result.titleChanged).toBe(true);
    expect(result.descriptionChanged).toBe(true);
  });

  it("a suggestion with one field unchanged is not rejected — it still appears in the result", () => {
    const suggestion = {
      contentId: "content-1",
      suggestedMetaTitle: INVENTORY[0].currentMetaTitle,
      suggestedMetaDescription: "A genuinely different description.",
      reasoning: "Rewrote the description.",
    };
    const result = filterValidSuggestions([suggestion], INVENTORY);
    expect(result).toHaveLength(1);
  });

  it("does not reject a suggestion where both fields are unchanged either", () => {
    const suggestion = {
      contentId: "content-1",
      suggestedMetaTitle: INVENTORY[0].currentMetaTitle,
      suggestedMetaDescription: INVENTORY[0].currentMetaDescription,
      reasoning: "No real change, just a claim of one.",
    };
    const result = filterValidSuggestions([suggestion], INVENTORY);
    expect(result).toHaveLength(1);
  });

  it("exact character counts remain correct regardless of changed status", () => {
    const suggestion = {
      contentId: "content-1",
      suggestedMetaTitle: INVENTORY[0].currentMetaTitle,
      suggestedMetaDescription: "A genuinely different description that is a bit longer than the original one.",
      reasoning: "Rewrote the description.",
    };
    const [result] = filterValidSuggestions([suggestion], INVENTORY);
    expect(result.titleLengthGuidance.length).toBe((INVENTORY[0].currentMetaTitle as string).length);
    expect(result.descriptionLengthGuidance.length).toBe(suggestion.suggestedMetaDescription.length);
  });

  it("existing length-guidance (warning, never rejection) behavior is unaffected by changed status", () => {
    const tooLongUnchangedText = "A".repeat(200); // outside both the 50-60 and 120-160 guidance ranges
    const suggestion = {
      contentId: "content-1",
      suggestedMetaTitle: tooLongUnchangedText,
      suggestedMetaDescription: tooLongUnchangedText,
      reasoning: "n/a",
    };
    const [result] = filterValidSuggestions([suggestion], [{ ...INVENTORY[0], currentMetaTitle: tooLongUnchangedText, currentMetaDescription: tooLongUnchangedText }]);
    expect(result.titleChanged).toBe(false);
    expect(result.descriptionChanged).toBe(false);
    expect(result.titleLengthGuidance.status).toBe("TOO_LONG");
    expect(result.descriptionLengthGuidance.status).toBe("TOO_LONG");
  });

  it("existing valid (genuinely changed) suggestions continue to work exactly as before", () => {
    const [result] = filterValidSuggestions([VALID_SUGGESTION_1], INVENTORY);
    expect(result.titleChanged).toBe(true);
    expect(result.descriptionChanged).toBe(true);
    expect(result.suggestedMetaTitle).toBe(VALID_TITLE);
    expect(result.suggestedMetaDescription).toBe(VALID_DESCRIPTION);
  });
});

/**
 * Stage C — the wrapper deferred by Stage B's own comment, now that the
 * real META_TAG_OPTIMIZATION AiTaskType exists. filterValidSuggestions
 * itself is exercised in full detail above (unchanged by Stage C); these
 * tests only prove the wiring, plus the two "partial AI response" behaviors
 * Stage C specifically called out.
 */
describe("generateMetaTagSuggestions", () => {
  it("calls generateStructuredOutput with taskType META_TAG_OPTIMIZATION and the current PROMPT_VERSION", async () => {
    mockGenerate.mockResolvedValue({ suggestions: [VALID_SUGGESTION_1] });
    await generateMetaTagSuggestions(BASE_CTX);
    const [, options] = mockGenerate.mock.calls[0];
    expect(options.taskType).toBe("META_TAG_OPTIMIZATION");
    expect(options.promptVersion).toBe(PROMPT_VERSION);
    expect(options.seoProjectId).toBe("project-1");
    expect(options.companyId).toBe("company-1");
  });

  it("fetches the Brand Profile by ctx.companyId", async () => {
    mockGenerate.mockResolvedValue({ suggestions: [] });
    await generateMetaTagSuggestions(BASE_CTX);
    expect(mockGetBrandProfile).toHaveBeenCalledWith("company-1");
  });

  it("uses the streaming orchestrator when onChunk is supplied, not the non-streaming one", async () => {
    mockGenerateStreaming.mockResolvedValue({ suggestions: [] });
    const onChunk = vi.fn();
    await generateMetaTagSuggestions(BASE_CTX, onChunk);
    expect(mockGenerateStreaming).toHaveBeenCalledTimes(1);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("applies the same deterministic filter to the live provider response, dropping a fabricated contentId while keeping the real one", async () => {
    const fabricated = { contentId: "content-does-not-exist", suggestedMetaTitle: "Fake", suggestedMetaDescription: "Fake description entirely.", reasoning: "n/a" };
    mockGenerate.mockResolvedValue({ suggestions: [VALID_SUGGESTION_1, fabricated] });
    const result = await generateMetaTagSuggestions(BASE_CTX);
    expect(result).toHaveLength(1);
    expect(result[0].contentId).toBe("content-1");
  });

  it("25. does not fabricate a missing suggestion — if the AI omits a selected page, the result simply has no entry for it", async () => {
    // Selected: content-1 and content-2. AI returns only content-1.
    mockGenerate.mockResolvedValue({ suggestions: [VALID_SUGGESTION_1] });
    const result = await generateMetaTagSuggestions(BASE_CTX);
    expect(result).toHaveLength(1);
    expect(result[0].contentId).toBe("content-1");
    expect(result.find((r) => r.contentId === "content-2")).toBeUndefined();
  });

  it("26. filters an extra/fabricated contentId the AI returns beyond the selected inventory", async () => {
    // Selected: content-1 and content-2. AI returns content-1, content-2, and a fabricated content-3.
    const forContent2 = { contentId: "content-2", suggestedMetaTitle: "Water Heater Repair & Install | Acme", suggestedMetaDescription: "Fast, licensed water heater repair and installation from Acme Plumbing.", reasoning: "Adds services and brand." };
    const fabricatedExtra = { contentId: "content-3", suggestedMetaTitle: "Not a real page", suggestedMetaDescription: "This page was never selected.", reasoning: "n/a" };
    mockGenerate.mockResolvedValue({ suggestions: [VALID_SUGGESTION_1, forContent2, fabricatedExtra] });
    const result = await generateMetaTagSuggestions(BASE_CTX);
    expect(result.map((r) => r.contentId).sort()).toEqual(["content-1", "content-2"]);
    expect(result.find((r) => r.contentId === "content-3")).toBeUndefined();
  });

  it("27. keeps duplicate-contentId filtering active end-to-end through the live provider response", async () => {
    const duplicate = { ...VALID_SUGGESTION_1, suggestedMetaTitle: "A different title for the same page" };
    mockGenerate.mockResolvedValue({ suggestions: [VALID_SUGGESTION_1, duplicate] });
    const result = await generateMetaTagSuggestions(BASE_CTX);
    expect(result).toHaveLength(1);
    expect(result[0].suggestedMetaTitle).toBe(VALID_TITLE);
  });

  it("28. keeps instruction-echo rejection active end-to-end through the live provider response", async () => {
    const echoed = { contentId: "content-2", suggestedMetaTitle: "meta title: EXACTLY 50-60 characters total", suggestedMetaDescription: "A perfectly fine description.", reasoning: "n/a" };
    mockGenerate.mockResolvedValue({ suggestions: [VALID_SUGGESTION_1, echoed] });
    const result = await generateMetaTagSuggestions(BASE_CTX);
    expect(result.map((r) => r.contentId)).toEqual(["content-1"]);
  });

  it("defaults to an empty array when the model omits the suggestions field", async () => {
    mockGenerate.mockResolvedValue({});
    const result = await generateMetaTagSuggestions(BASE_CTX);
    expect(result).toEqual([]);
  });
});
