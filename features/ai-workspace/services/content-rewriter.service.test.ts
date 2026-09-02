import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/structured-output", () => ({
  generateStructuredOutput: vi.fn(),
  generateStructuredOutputStreaming: vi.fn(),
}));

import { generateStructuredOutput, generateStructuredOutputStreaming } from "@/lib/ai/structured-output";
import {
  buildContentRewriteResult,
  buildPrompt,
  generateContentRewrite,
  CONTENT_REWRITER_SYSTEM_PROMPT,
  PROMPT_VERSION,
  type ContentRewriterContext,
} from "@/features/ai-workspace/services/content-rewriter.service";

const mockGenerate = vi.mocked(generateStructuredOutput);
const mockGenerateStreaming = vi.mocked(generateStructuredOutputStreaming);

beforeEach(() => {
  mockGenerate.mockReset();
  mockGenerateStreaming.mockReset();
});

const BASE_CTX: ContentRewriterContext = {
  contentId: "content-1",
  companyId: "company-1",
  seoProjectId: "project-1",
  seoProjectName: "Acme Plumbing",
  domain: "acme-plumbing.example.com",
  currentTitle: "Emergency Plumbing Guide",
  currentMetaTitle: "Emergency Plumbing | Acme",
  currentMetaDescription: "Old description about emergency plumbing.",
  currentBody: "## Introduction\n\nAcme Plumbing offers 24/7 emergency repair.\n\n## Services\n\nWe fix burst pipes and water heaters.",
};

const VALID_TITLE = "Emergency Plumbing Repair in Austin | Acme Plumbing";
const VALID_META_TITLE = "24/7 Emergency Plumbing | Acme Plumbing Co";
const VALID_META_DESCRIPTION = "Burst pipe or no hot water? Acme Plumbing offers fast, licensed 24/7 emergency repair across Austin.";
const VALID_BODY = "## Introduction\n\nAcme Plumbing provides round-the-clock emergency repair across Austin.\n\n## Our Services\n\nWe repair burst pipes, water heaters, and more.";

const VALID_RAW = {
  rewrittenTitle: VALID_TITLE,
  rewrittenMetaTitle: VALID_META_TITLE,
  rewrittenMetaDescription: VALID_META_DESCRIPTION,
  rewrittenBody: VALID_BODY,
  reasoning: "Added a location and clarified the services offered.",
};

describe("buildPrompt", () => {
  it("includes the current title/meta title/meta description/body verbatim", () => {
    const prompt = buildPrompt(BASE_CTX);
    expect(prompt).toContain('Current title: "Emergency Plumbing Guide"');
    expect(prompt).toContain('Current meta title: "Emergency Plumbing | Acme"');
    expect(prompt).toContain('Current meta description: "Old description about emergency plumbing."');
    expect(prompt).toContain(BASE_CTX.currentBody);
  });

  it("shows (none set) for a null current meta title/description rather than fabricating placeholder text", () => {
    const prompt = buildPrompt({ ...BASE_CTX, currentMetaTitle: null, currentMetaDescription: null });
    expect(prompt).toContain("Current meta title: (none set)");
    expect(prompt).toContain("Current meta description: (none set)");
  });

  it("instructs the model to stay grounded in the current content and never invent new facts", () => {
    const prompt = buildPrompt(BASE_CTX);
    expect(prompt).toContain("grounded strictly in the current content above");
    expect(prompt).toContain("never introduce a fact, claim, or topic that isn't already there");
  });

  it("asks for exactly the five output fields", () => {
    const prompt = buildPrompt(BASE_CTX);
    expect(prompt).toContain("rewrittenTitle");
    expect(prompt).toContain("rewrittenMetaTitle");
    expect(prompt).toContain("rewrittenMetaDescription");
    expect(prompt).toContain("rewrittenBody");
    expect(prompt).toContain("reasoning");
  });
});

describe("CONTENT_REWRITER_SYSTEM_PROMPT", () => {
  it("forbids inventing facts not already in the supplied content", () => {
    expect(CONTENT_REWRITER_SYSTEM_PROMPT).toMatch(/never invent a new fact/i);
  });

  it("requires the rewritten body to remain valid Markdown", () => {
    expect(CONTENT_REWRITER_SYSTEM_PROMPT).toMatch(/valid Markdown/);
  });

  it("permits returning a field unchanged rather than forcing a change", () => {
    expect(CONTENT_REWRITER_SYSTEM_PROMPT).toMatch(/return it unchanged/i);
  });
});

describe("buildContentRewriteResult — deterministic change detection", () => {
  it("1. a valid rewrite with all fields changed returns a populated result with every *Changed flag true", () => {
    const result = buildContentRewriteResult(VALID_RAW, BASE_CTX);
    expect(result).not.toBeNull();
    expect(result?.titleChanged).toBe(true);
    expect(result?.metaTitleChanged).toBe(true);
    expect(result?.metaDescriptionChanged).toBe(true);
    expect(result?.bodyChanged).toBe(true);
    expect(result?.rewrittenTitle).toBe(VALID_TITLE);
    expect(result?.rewrittenBody).toBe(VALID_BODY);
    expect(result?.contentId).toBe("content-1");
  });

  it("2. carries the real current values through untouched, never from the AI", () => {
    const result = buildContentRewriteResult(VALID_RAW, BASE_CTX);
    expect(result?.currentTitle).toBe(BASE_CTX.currentTitle);
    expect(result?.currentMetaTitle).toBe(BASE_CTX.currentMetaTitle);
    expect(result?.currentMetaDescription).toBe(BASE_CTX.currentMetaDescription);
    expect(result?.currentBody).toBe(BASE_CTX.currentBody);
  });

  it("3. unchanged title: titleChanged is false when the AI returns the exact current title", () => {
    const result = buildContentRewriteResult({ ...VALID_RAW, rewrittenTitle: BASE_CTX.currentTitle }, BASE_CTX);
    expect(result?.titleChanged).toBe(false);
    expect(result?.metaTitleChanged).toBe(true);
    expect(result?.metaDescriptionChanged).toBe(true);
    expect(result?.bodyChanged).toBe(true);
  });

  it("4. unchanged meta title: metaTitleChanged is false when the AI returns the exact current meta title", () => {
    const result = buildContentRewriteResult({ ...VALID_RAW, rewrittenMetaTitle: BASE_CTX.currentMetaTitle as string }, BASE_CTX);
    expect(result?.metaTitleChanged).toBe(false);
  });

  it("5. unchanged meta description: metaDescriptionChanged is false when the AI returns the exact current meta description", () => {
    const result = buildContentRewriteResult({ ...VALID_RAW, rewrittenMetaDescription: BASE_CTX.currentMetaDescription as string }, BASE_CTX);
    expect(result?.metaDescriptionChanged).toBe(false);
  });

  it("6. unchanged body: bodyChanged is false when the AI returns the exact current body", () => {
    const result = buildContentRewriteResult({ ...VALID_RAW, rewrittenBody: BASE_CTX.currentBody }, BASE_CTX);
    expect(result?.bodyChanged).toBe(false);
  });

  it("7. no changes at all: every *Changed flag is false, but the result is still valid (never rejected merely for being unchanged)", () => {
    const result = buildContentRewriteResult(
      {
        rewrittenTitle: BASE_CTX.currentTitle,
        rewrittenMetaTitle: BASE_CTX.currentMetaTitle,
        rewrittenMetaDescription: BASE_CTX.currentMetaDescription,
        rewrittenBody: BASE_CTX.currentBody,
        reasoning: "The page is already well-optimized; no changes were necessary.",
      },
      BASE_CTX
    );
    expect(result).not.toBeNull();
    expect(result?.titleChanged).toBe(false);
    expect(result?.metaTitleChanged).toBe(false);
    expect(result?.metaDescriptionChanged).toBe(false);
    expect(result?.bodyChanged).toBe(false);
  });

  it("8. partial changes: exactly one field changed still returns a valid result with the other three flags false", () => {
    const result = buildContentRewriteResult(
      {
        rewrittenTitle: BASE_CTX.currentTitle,
        rewrittenMetaTitle: BASE_CTX.currentMetaTitle,
        rewrittenMetaDescription: VALID_META_DESCRIPTION,
        rewrittenBody: BASE_CTX.currentBody,
        reasoning: "Only the meta description needed sharpening.",
      },
      BASE_CTX
    );
    expect(result).not.toBeNull();
    expect(result?.titleChanged).toBe(false);
    expect(result?.metaTitleChanged).toBe(false);
    expect(result?.metaDescriptionChanged).toBe(true);
    expect(result?.bodyChanged).toBe(false);
  });

  it("9. a null current meta title/description can never equal a real non-empty rewritten string — correctly reported as changed", () => {
    const ctx = { ...BASE_CTX, currentMetaTitle: null, currentMetaDescription: null };
    const result = buildContentRewriteResult(VALID_RAW, ctx);
    expect(result?.metaTitleChanged).toBe(true);
    expect(result?.metaDescriptionChanged).toBe(true);
    expect(result?.currentMetaTitle).toBeNull();
    expect(result?.currentMetaDescription).toBeNull();
  });
});

describe("buildContentRewriteResult — reject, never repair", () => {
  it("10. rejects a non-object raw value", () => {
    expect(buildContentRewriteResult(null, BASE_CTX)).toBeNull();
    expect(buildContentRewriteResult("a string", BASE_CTX)).toBeNull();
    expect(buildContentRewriteResult(42, BASE_CTX)).toBeNull();
  });

  it("11. rejects when any required field has the wrong type", () => {
    expect(buildContentRewriteResult({ ...VALID_RAW, rewrittenTitle: 123 }, BASE_CTX)).toBeNull();
    expect(buildContentRewriteResult({ ...VALID_RAW, rewrittenMetaTitle: null }, BASE_CTX)).toBeNull();
    expect(buildContentRewriteResult({ ...VALID_RAW, rewrittenMetaDescription: undefined }, BASE_CTX)).toBeNull();
    expect(buildContentRewriteResult({ ...VALID_RAW, rewrittenBody: {} }, BASE_CTX)).toBeNull();
  });

  it("12. rejects a missing or empty reasoning", () => {
    expect(buildContentRewriteResult({ ...VALID_RAW, reasoning: "" }, BASE_CTX)).toBeNull();
    expect(buildContentRewriteResult({ ...VALID_RAW, reasoning: "   " }, BASE_CTX)).toBeNull();
    const withoutReasoning: Record<string, unknown> = { ...VALID_RAW };
    delete withoutReasoning.reasoning;
    expect(buildContentRewriteResult(withoutReasoning, BASE_CTX)).toBeNull();
  });

  it("13. rejects when the rewritten title is empty after cleaning", () => {
    expect(buildContentRewriteResult({ ...VALID_RAW, rewrittenTitle: "   " }, BASE_CTX)).toBeNull();
  });

  it("13b. rejects when the rewritten meta title is empty after cleaning", () => {
    expect(buildContentRewriteResult({ ...VALID_RAW, rewrittenMetaTitle: "" }, BASE_CTX)).toBeNull();
  });

  it("13c. rejects when the rewritten meta description is empty after cleaning", () => {
    expect(buildContentRewriteResult({ ...VALID_RAW, rewrittenMetaDescription: "" }, BASE_CTX)).toBeNull();
  });

  it("13d. rejects when the rewritten body is empty after cleaning", () => {
    expect(buildContentRewriteResult({ ...VALID_RAW, rewrittenBody: "   " }, BASE_CTX)).toBeNull();
  });

  it("14. strips a leaked trailing configuration artifact from the title without rejecting it", () => {
    const result = buildContentRewriteResult({ ...VALID_RAW, rewrittenTitle: `${VALID_TITLE} | 1500 words` }, BASE_CTX);
    expect(result).not.toBeNull();
    expect(result?.rewrittenTitle).toBe(VALID_TITLE);
  });

  it("15. strips a leaked leading outline-numbering artifact from the meta title without rejecting it", () => {
    const result = buildContentRewriteResult({ ...VALID_RAW, rewrittenMetaTitle: `1. ${VALID_META_TITLE}` }, BASE_CTX);
    expect(result).not.toBeNull();
    expect(result?.rewrittenMetaTitle).toBe(VALID_META_TITLE);
  });

  it("16. strips a leaked trailing configuration artifact from the body without collapsing its internal Markdown structure", () => {
    const bodyWithArtifact = `${VALID_BODY}\n| 1500 words`;
    const result = buildContentRewriteResult({ ...VALID_RAW, rewrittenBody: bodyWithArtifact }, BASE_CTX);
    expect(result).not.toBeNull();
    expect(result?.rewrittenBody).toBe(VALID_BODY);
    // The internal blank line between the two headings must survive — proof
    // that the body is never run through stripHtmlTags's whitespace collapse.
    expect(result?.rewrittenBody).toContain("\n\n");
  });

  it("17. strips an HTML tag from the title/meta fields", () => {
    const result = buildContentRewriteResult({ ...VALID_RAW, rewrittenTitle: `<b>${VALID_TITLE}</b>` }, BASE_CTX);
    expect(result?.rewrittenTitle).toBe(VALID_TITLE);
  });

  it("18. rejects an instruction-echoed title", () => {
    const result = buildContentRewriteResult({ ...VALID_RAW, rewrittenTitle: "meta title: something" }, BASE_CTX);
    expect(result).toBeNull();
  });

  it("19. rejects an instruction-echoed meta description", () => {
    const result = buildContentRewriteResult({ ...VALID_RAW, rewrittenMetaDescription: "EXACTLY 120-160 characters" }, BASE_CTX);
    expect(result).toBeNull();
  });

  it("20. rejects an instruction-echoed body", () => {
    const result = buildContentRewriteResult({ ...VALID_RAW, rewrittenBody: "150 words, 900 characters" }, BASE_CTX);
    expect(result).toBeNull();
  });
});

describe("generateContentRewrite", () => {
  it("21. calls generateStructuredOutput with taskType CONTENT_REWRITE and the current PROMPT_VERSION", async () => {
    mockGenerate.mockResolvedValue(VALID_RAW);
    await generateContentRewrite(BASE_CTX);
    expect(mockGenerate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ taskType: "CONTENT_REWRITE", promptVersion: PROMPT_VERSION, companyId: "company-1", seoProjectId: "project-1" })
    );
  });

  it("22. uses generateStructuredOutputStreaming instead when an onChunk callback is supplied", async () => {
    mockGenerateStreaming.mockResolvedValue(VALID_RAW);
    const onChunk = vi.fn();
    await generateContentRewrite(BASE_CTX, onChunk);
    expect(mockGenerateStreaming).toHaveBeenCalled();
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("23. returns a fully-built ContentRewriteResult for a valid provider response", async () => {
    mockGenerate.mockResolvedValue(VALID_RAW);
    const result = await generateContentRewrite(BASE_CTX);
    expect(result).not.toBeNull();
    expect(result?.rewrittenTitle).toBe(VALID_TITLE);
    expect(result?.titleChanged).toBe(true);
  });

  it("24. returns null (a successful, empty outcome) when the provider's response is fully invalid — never throws", async () => {
    mockGenerate.mockResolvedValue({ rewrittenTitle: "", rewrittenMetaTitle: "", rewrittenMetaDescription: "", rewrittenBody: "", reasoning: "" });
    const result = await generateContentRewrite(BASE_CTX);
    expect(result).toBeNull();
  });
});
