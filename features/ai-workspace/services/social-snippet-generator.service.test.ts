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
  filterValidSnippets,
  generateSocialSnippets,
  SOCIAL_SNIPPET_GENERATOR_SYSTEM_PROMPT,
  PROMPT_VERSION,
  type SocialSnippetGeneratorContext,
} from "@/features/ai-workspace/services/social-snippet-generator.service";

const mockGenerate = vi.mocked(generateStructuredOutput);
const mockGenerateStreaming = vi.mocked(generateStructuredOutputStreaming);
const mockGetBrandProfile = vi.mocked(getBrandProfileByCompanyId);

beforeEach(() => {
  mockGenerate.mockReset();
  mockGenerateStreaming.mockReset();
  mockGetBrandProfile.mockReset();
  mockGetBrandProfile.mockResolvedValue(null);
});

const BASE_CTX: SocialSnippetGeneratorContext = {
  seoProjectId: "project-1",
  companyId: "company-1",
  seoProjectName: "Acme Plumbing",
  domain: "acme-plumbing.example.com",
  sourceContent: {
    title: "Emergency Plumbing Guide",
    url: "https://acme-plumbing.example.com/emergency",
    metaDescription: "24/7 emergency plumbing tips.",
    body: "If you have a burst pipe, shut off the main water valve immediately.",
  },
  platforms: ["X", "LINKEDIN", "FACEBOOK"],
};

const VALID_X = { platform: "X", text: "Burst pipe? Shut off your main valve first, then call us — we're here 24/7." };

describe("buildPrompt", () => {
  it("includes the source content title, url, and description", () => {
    const prompt = buildPrompt(BASE_CTX);
    expect(prompt).toContain('Content to promote: "Emergency Plumbing Guide" (https://acme-plumbing.example.com/emergency)');
    expect(prompt).toContain("Content description: 24/7 emergency plumbing tips.");
  });

  it("includes a body excerpt", () => {
    const prompt = buildPrompt(BASE_CTX);
    expect(prompt).toContain("shut off the main water valve immediately");
  });

  it("states each requested platform's real character limit, and states no strict limit for Facebook", () => {
    const prompt = buildPrompt(BASE_CTX);
    expect(prompt).toContain("must stay under 280 characters");
    expect(prompt).toContain("must stay under 3000 characters");
    expect(prompt).toContain("no strict character limit");
  });

  it("instructs that a link must come only from the source content's own real URL, and warns against including one when there is no URL", () => {
    const prompt = buildPrompt({ ...BASE_CTX, sourceContent: { ...BASE_CTX.sourceContent, url: null } });
    expect(prompt).toContain("This content has no published URL yet — do not include a link in any snippet.");
  });

  it("includes Brand Profile fields when supplied, as supplementary context only", () => {
    const prompt = buildPrompt(BASE_CTX, {
      brandName: "Acme Plumbing Co",
      brandVoice: "friendly and direct",
      targetAudience: "homeowners",
      targetCountry: "United States",
      language: "English",
      productsServices: "Emergency plumbing repair",
    } as never);
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

  it("includes user notes when supplied, with a caveat that they cannot override safety rules", () => {
    const prompt = buildPrompt({ ...BASE_CTX, notes: "lean into urgency" });
    expect(prompt).toContain("lean into urgency");
    expect(prompt).toContain("must not override source-content truth, character limits, or safety rules");
  });

  it("instructs the model to skip a platform rather than force a weak snippet", () => {
    const prompt = buildPrompt(BASE_CTX);
    expect(prompt).toContain("Skip a platform entirely");
  });
});

describe("SOCIAL_SNIPPET_GENERATOR_SYSTEM_PROMPT", () => {
  it("establishes the supplied source content as the only source of truth and forbids inventing facts", () => {
    expect(SOCIAL_SNIPPET_GENERATOR_SYSTEM_PROMPT).toContain("The supplied source content is the ONLY source of truth");
    expect(SOCIAL_SNIPPET_GENERATOR_SYSTEM_PROMPT).toContain("Never invent a statistic, quote, testimonial, review, endorsement, product, service, person, organization, date, price, award, or certification");
  });

  it("forbids inventing a URL and requires any included URL to be the supplied source content's own URL", () => {
    expect(SOCIAL_SNIPPET_GENERATOR_SYSTEM_PROMPT).toContain("it must be exactly the supplied source content's own URL — never invent or guess a URL");
  });

  it("states Brand Profile boundaries: tone/audience only, never a new fact", () => {
    expect(SOCIAL_SNIPPET_GENERATOR_SYSTEM_PROMPT).toContain("use it only to shape tone, audience framing, language, and brand identity");
    expect(SOCIAL_SNIPPET_GENERATOR_SYSTEM_PROMPT).toContain("brand context must never introduce a fact that is not present in the supplied source content");
  });

  it("states platform character limits must be respected, comfortably below the hard limit", () => {
    expect(SOCIAL_SNIPPET_GENERATOR_SYSTEM_PROMPT).toContain("Respect each requested platform's character limit exactly");
    expect(SOCIAL_SNIPPET_GENERATOR_SYSTEM_PROMPT).toContain("write comfortably below the hard limit");
  });

  it("explicitly allows zero or fewer snippets and forbids guessing to fill the requested count", () => {
    expect(SOCIAL_SNIPPET_GENERATOR_SYSTEM_PROMPT).toContain("Zero or fewer recommendations is acceptable. Never guess to fill the requested number.");
  });
});

describe("filterValidSnippets", () => {
  it("1. accepts a valid X snippet under the 280 character limit", () => {
    expect(filterValidSnippets([VALID_X])).toEqual([{ platform: "X", text: VALID_X.text, characterCount: VALID_X.text.length }]);
  });

  it("2. accepts a valid LinkedIn snippet under the 3000 character limit", () => {
    const rec = { platform: "LINKEDIN", text: "A longer, professional post about emergency plumbing best practices for homeowners." };
    expect(filterValidSnippets([rec])).toEqual([{ platform: "LINKEDIN", text: rec.text, characterCount: rec.text.length }]);
  });

  it("3. accepts a valid Facebook snippet with no artificial hard limit imposed", () => {
    const longText = "A".repeat(5000);
    const rec = { platform: "FACEBOOK", text: longText };
    expect(filterValidSnippets([rec])).toEqual([{ platform: "FACEBOOK", text: longText, characterCount: 5000 }]);
  });

  it("4. rejects an X snippet over 280 characters", () => {
    const rec = { platform: "X", text: "A".repeat(281) };
    expect(filterValidSnippets([rec])).toEqual([]);
  });

  it("5. rejects a LinkedIn snippet over 3000 characters", () => {
    const rec = { platform: "LINKEDIN", text: "A".repeat(3001) };
    expect(filterValidSnippets([rec])).toEqual([]);
  });

  it("6. rejects a structurally malformed item (not an object) without throwing", () => {
    expect(filterValidSnippets(["just a string"])).toEqual([]);
    expect(filterValidSnippets([null])).toEqual([]);
  });

  it("7. rejects an item with an empty or whitespace-only text field", () => {
    expect(filterValidSnippets([{ platform: "X", text: "" }])).toEqual([]);
    expect(filterValidSnippets([{ platform: "X", text: "   " }])).toEqual([]);
  });

  it("8. rejects an item with an invalid platform value", () => {
    expect(filterValidSnippets([{ platform: "INSTAGRAM", text: "Check out our new post!" }])).toEqual([]);
  });

  it("9. rejects an item missing a required field", () => {
    expect(filterValidSnippets([{ platform: "X" }])).toEqual([]);
    expect(filterValidSnippets([{ text: "no platform here" }])).toEqual([]);
  });

  it("10. keeps valid snippets while dropping only the invalid ones in the same batch", () => {
    const overLimit = { platform: "X", text: "A".repeat(281) };
    expect(filterValidSnippets([VALID_X, overLimit])).toEqual([{ platform: "X", text: VALID_X.text, characterCount: VALID_X.text.length }]);
  });

  it("11. returns an empty array, not an error, when every item is invalid", () => {
    expect(filterValidSnippets([{ platform: "INSTAGRAM", text: "x" }, { platform: "X", text: "" }])).toEqual([]);
  });

  it("12. calculates characterCount from the actual text.length, never trusting a model-supplied characterCount field", () => {
    const rec = { platform: "X", text: "Short post.", characterCount: 999999 };
    const result = filterValidSnippets([rec]);
    expect(result).toEqual([{ platform: "X", text: "Short post.", characterCount: "Short post.".length }]);
  });

  it("13. never truncates or rewrites the text — the accepted text is character-for-character identical to the input", () => {
    const rec = { platform: "LINKEDIN", text: "Line one.\nLine two with an emoji 🚿 and a #hashtag." };
    const [result] = filterValidSnippets([rec]);
    expect(result.text).toBe(rec.text);
  });

  it("14. normalizes platform case and the TWITTER synonym deterministically, without accepting a fuzzy/guessed value", () => {
    expect(filterValidSnippets([{ platform: "x", text: "lowercase platform" }])[0]?.platform).toBe("X");
    expect(filterValidSnippets([{ platform: "TWITTER", text: "twitter synonym" }])[0]?.platform).toBe("X");
    expect(filterValidSnippets([{ platform: "Tweet", text: "not a real platform value" }])).toEqual([]);
  });

  it("15. returns an empty array unchanged for empty input", () => {
    expect(filterValidSnippets([])).toEqual([]);
  });

  it("16. rejects a snippet containing a fabricated URL when the source content has no real url — the defect found during live verification", () => {
    const rec = { platform: "X", text: "Check it out: https://fabricated.example.com/made-up-page" };
    expect(filterValidSnippets([rec], null)).toEqual([]);
  });

  it("17. accepts a snippet whose URL is exactly the source content's own real url", () => {
    const rec = { platform: "X", text: "Read more: https://acme-plumbing.example.com/emergency" };
    expect(filterValidSnippets([rec], "https://acme-plumbing.example.com/emergency")).toEqual([
      { platform: "X", text: rec.text, characterCount: rec.text.length },
    ]);
  });

  it("18. rejects a snippet whose URL does not exactly match the source content's real url, even when a real url was supplied", () => {
    const rec = { platform: "X", text: "Read more: https://acme-plumbing.example.com/wrong-page" };
    expect(filterValidSnippets([rec], "https://acme-plumbing.example.com/emergency")).toEqual([]);
  });

  it("19. accepts a snippet with no URL at all regardless of whether a real url was supplied", () => {
    const rec = { platform: "X", text: "No link here, just a short promotional post." };
    expect(filterValidSnippets([rec], null)).toEqual([{ platform: "X", text: rec.text, characterCount: rec.text.length }]);
    expect(filterValidSnippets([rec], "https://acme-plumbing.example.com/emergency")).toEqual([{ platform: "X", text: rec.text, characterCount: rec.text.length }]);
  });

  const LINKEDIN_ITEM = { platform: "LINKEDIN", text: "A professional post about emergency plumbing best practices for homeowners." };
  const FACEBOOK_ITEM = { platform: "FACEBOOK", text: "Emergency plumbing tips every homeowner should know about." };

  it("20. returns one result per platform when three unique platforms are all valid", () => {
    const result = filterValidSnippets([VALID_X, LINKEDIN_ITEM, FACEBOOK_ITEM]);
    expect(result.map((r) => r.platform).sort()).toEqual(["FACEBOOK", "LINKEDIN", "X"]);
    expect(result).toHaveLength(3);
  });

  it("21. drops a duplicate X appended after the three unique platforms, keeping exactly one X", () => {
    const duplicateX = { platform: "X", text: "A different, later X post about the same topic." };
    const result = filterValidSnippets([VALID_X, LINKEDIN_ITEM, FACEBOOK_ITEM, duplicateX]);
    expect(result).toHaveLength(3);
    const xResults = result.filter((r) => r.platform === "X");
    expect(xResults).toHaveLength(1);
    expect(xResults[0].text).toBe(VALID_X.text);
  });

  it("22. reduces three duplicate X snippets to exactly one, keeping the first", () => {
    const secondX = { platform: "X", text: "Second X post." };
    const thirdX = { platform: "X", text: "Third X post." };
    const result = filterValidSnippets([VALID_X, secondX, thirdX]);
    expect(result).toEqual([{ platform: "X", text: VALID_X.text, characterCount: VALID_X.text.length }]);
  });

  it("23. reduces a duplicate LinkedIn snippet to exactly one, keeping the first", () => {
    const secondLinkedIn = { platform: "LINKEDIN", text: "A second, different LinkedIn post." };
    const result = filterValidSnippets([LINKEDIN_ITEM, secondLinkedIn]);
    expect(result).toEqual([{ platform: "LINKEDIN", text: LINKEDIN_ITEM.text, characterCount: LINKEDIN_ITEM.text.length }]);
  });

  it("24. reduces a duplicate Facebook snippet to exactly one, keeping the first", () => {
    const secondFacebook = { platform: "FACEBOOK", text: "A second, different Facebook post." };
    const result = filterValidSnippets([FACEBOOK_ITEM, secondFacebook]);
    expect(result).toEqual([{ platform: "FACEBOOK", text: FACEBOOK_ITEM.text, characterCount: FACEBOOK_ITEM.text.length }]);
  });

  it("25. deduplicates equivalent platform representations under the EXISTING canonical normalization only (case and the TWITTER synonym) — does not invent new equivalences", () => {
    // "x" and "TWITTER" both normalize to "X" under the existing rules,
    // so a second one is a duplicate of the first, same as literal "X".
    const lowercaseX = { platform: "x", text: "Lowercase platform value." };
    const twitterSynonym = { platform: "TWITTER", text: "Twitter synonym value." };
    const result = filterValidSnippets([lowercaseX, twitterSynonym]);
    expect(result).toEqual([{ platform: "X", text: lowercaseX.text, characterCount: lowercaseX.text.length }]);

    // "X (Twitter)" is NOT part of the existing normalization rules (only
    // exact "TWITTER" and case are handled) — it must continue to be
    // rejected as an unrecognized platform value, not silently treated as
    // an equivalent of "X". Confirms this fix reuses existing
    // canonicalization rather than inventing a new one.
    expect(filterValidSnippets([{ platform: "X (Twitter)", text: "Should be rejected, not treated as X." }])).toEqual([]);
  });

  it("26. still rejects a fabricated/unverifiable URL even when deduplication would otherwise have kept the item", () => {
    const fabricated = { platform: "X", text: "Check it out: https://fabricated.example.com/made-up-page" };
    const validSecondX = { platform: "X", text: "A perfectly valid X post with no link at all." };
    // The fabricated one appears first; it must still be rejected on its
    // own merits (never accepted just because it was "first"), and the
    // later, genuinely valid X snippet is then the one kept.
    const result = filterValidSnippets([fabricated, validSecondX], null);
    expect(result).toEqual([{ platform: "X", text: validSecondX.text, characterCount: validSecondX.text.length }]);
  });

  it("27. does not remove a valid snippet for one platform merely because another platform's snippet is invalid", () => {
    const fabricatedLinkedIn = { platform: "LINKEDIN", text: "Read more: https://fabricated.example.com/made-up-page" };
    const result = filterValidSnippets([VALID_X, fabricatedLinkedIn, FACEBOOK_ITEM], null);
    expect(result.map((r) => r.platform).sort()).toEqual(["FACEBOOK", "X"]);
  });
});

describe("generateSocialSnippets", () => {
  it("calls generateStructuredOutput with taskType SOCIAL_SNIPPET_GENERATION and the current PROMPT_VERSION", async () => {
    mockGenerate.mockResolvedValue({ snippets: [VALID_X] });
    await generateSocialSnippets(BASE_CTX);
    const [, options] = mockGenerate.mock.calls[0];
    expect(options.taskType).toBe("SOCIAL_SNIPPET_GENERATION");
    expect(options.promptVersion).toBe(PROMPT_VERSION);
    expect(options.seoProjectId).toBe("project-1");
    expect(options.companyId).toBe("company-1");
  });

  it("fetches the Brand Profile by ctx.companyId — no profile works without error", async () => {
    mockGenerate.mockResolvedValue({ snippets: [] });
    await generateSocialSnippets(BASE_CTX);
    expect(mockGetBrandProfile).toHaveBeenCalledWith("company-1");
  });

  it("fetches and uses a real Brand Profile when one exists", async () => {
    mockGetBrandProfile.mockResolvedValue({ brandName: "Acme Plumbing Co" } as never);
    mockGenerate.mockResolvedValue({ snippets: [] });
    await generateSocialSnippets(BASE_CTX);
    const [, options] = mockGenerate.mock.calls[0];
    expect(options.prompt).toContain("Brand name: Acme Plumbing Co.");
  });

  it("uses the streaming orchestrator when onChunk is supplied, not the non-streaming one", async () => {
    mockGenerateStreaming.mockResolvedValue({ snippets: [] });
    const onChunk = vi.fn();
    await generateSocialSnippets(BASE_CTX, onChunk);
    expect(mockGenerateStreaming).toHaveBeenCalledTimes(1);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("applies the same deterministic character-limit filter to the live provider response, dropping an over-limit snippet", async () => {
    const overLimit = { platform: "X", text: "A".repeat(281) };
    mockGenerate.mockResolvedValue({ snippets: [VALID_X, overLimit] });
    const result = await generateSocialSnippets(BASE_CTX);
    expect(result).toEqual([{ platform: "X", text: VALID_X.text, characterCount: VALID_X.text.length }]);
  });

  it("defaults to an empty array when the model omits the snippets field", async () => {
    mockGenerate.mockResolvedValue({});
    const result = await generateSocialSnippets(BASE_CTX);
    expect(result).toEqual([]);
  });

  it("passes the source content's real url through to the deterministic URL filter, rejecting a fabricated one", async () => {
    const fabricated = { platform: "X", text: "Check it out: https://totally-made-up.example.com/page" };
    mockGenerate.mockResolvedValue({ snippets: [fabricated] });
    const result = await generateSocialSnippets(BASE_CTX);
    expect(result).toEqual([]);
  });

  it("keeps duplicate-platform filtering active end-to-end through the live provider response — reproduces the reported screenshot (X, LinkedIn, Facebook, X) as exactly 3 results", async () => {
    const linkedIn = { platform: "LinkedIn", text: "A professional LinkedIn post." };
    const facebook = { platform: "FACEBOOK", text: "A friendly Facebook post." };
    const duplicateX = { platform: "X", text: "A second, later X post." };
    mockGenerate.mockResolvedValue({ snippets: [VALID_X, linkedIn, facebook, duplicateX] });
    const result = await generateSocialSnippets(BASE_CTX);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.platform).sort()).toEqual(["FACEBOOK", "LINKEDIN", "X"]);
    expect(result.find((r) => r.platform === "X")?.text).toBe(VALID_X.text);
  });

  it("existing partial-response behavior remains safe: a missing platform is not fabricated, and an extra/unrequested one is still dropped", async () => {
    // ctx.platforms is ["X", "LINKEDIN", "FACEBOOK"]; the AI omits LinkedIn
    // entirely and also returns an unrecognized platform value.
    mockGenerate.mockResolvedValue({ snippets: [VALID_X, { platform: "FACEBOOK", text: "A Facebook post." }, { platform: "INSTAGRAM", text: "Not a supported platform." }] });
    const result = await generateSocialSnippets(BASE_CTX);
    expect(result.map((r) => r.platform).sort()).toEqual(["FACEBOOK", "X"]);
    expect(result.find((r) => r.platform === "LINKEDIN")).toBeUndefined();
  });
});
