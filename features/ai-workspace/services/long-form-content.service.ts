import { z as zv4 } from "zod/v4";

import { generateStructuredOutput, generateStructuredOutputStreaming } from "@/lib/ai/structured-output";
import type { StreamEvent } from "@/lib/ai/providers/types";
import type { ContentBriefOutput } from "@/features/ai-workspace/schemas/content-brief.schema";
import { buildSharedContextClauses, DEFAULT_CONTENT_BRIEF_SETTINGS, type ContentBriefSettings } from "@/features/ai-workspace/schemas/content-brief-settings.schema";
import { buildLongFormOutputSchema } from "@/features/ai-workspace/schemas/long-form-output-builder";
import { formatLongFormContentAsMarkdown, longFormContentOutputSchema, type LongFormContentOutput } from "@/features/ai-workspace/schemas/long-form-content.schema";
import { CONTENT_QUALITY_DOCTRINE } from "@/features/ai-workspace/services/content-quality-doctrine";
import { filterReservedSections, stripConfigurationArtifacts, stripHtmlTags } from "@/features/ai-workspace/services/content-sanitizer";
import { computeWordCount } from "@/features/ai-workspace/services/seo-checklist.service";
import { getKnowledgeSourceContextForSeoProject } from "@/features/seo/services/knowledge-source-context.service";

/**
 * Bumped whenever the prompt template below changes — own, independent
 * version from content-brief.service.ts's PROMPT_VERSION, same convention
 * as every existing AI task in this app keeping its own counter.
 */
export const PROMPT_VERSION = 10;

const LONG_FORM_SYSTEM_PROMPT = `${CONTENT_QUALITY_DOCTRINE} You are a senior SEO content writer producing a DRAFT article for internal human review before anything is published. Never invent statistics, prices, dates, named clients, testimonials, certifications, or services/locations not present in the supplied context. Never state a specific market statistic, percentage, financial figure, or industry data point (e.g. typical unit sizes, utilization rates, market share) unless it is present in the supplied context — describe such things qualitatively instead of inventing a number. Never characterize a specific real company or brand name as a generic category, product type, or common noun — if a real company name appears in the supplied context, refer to it accurately as a company/provider, not as a type of product or service. Never invent a URL, citation, or source you cannot verify. Integrate the target keyword naturally — do not keyword-stuff. This is a draft; a human will fact-check it before it is ever published.`;

/**
 * Shared by buildPrompt (what the model is told) and the Phase 4 refinement
 * controller below (what actually gates whether refinement runs) — kept as
 * one function so the two can never drift apart.
 */
function computeAcceptableRange(wordCount: number): { lowWords: number; highWords: number } {
  return { lowWords: Math.round(wordCount * 0.93), highWords: Math.round(wordCount * 1.07) };
}

export type LongFormContentContext = {
  /** Provenance for the AiUsageLog row — never a WebsiteAnalysisJob, same as content-brief.service.ts. */
  seoProjectId: string;
  /** Phase 19 — required for enforceCompanyAiLimits. */
  companyId: string;
  seoProjectName: string;
  domain: string;
  /** The already-approved brief — from content-brief.service.ts, either still in memory or read back from a saved Content row's stored fields. */
  brief: ContentBriefOutput;
  keyword: { term: string; intent: string | null } | null;
  /** Phase 21 — the same settings object used to generate the brief; defaults reproduce Phase 20's fixed-shape 900-1500-word behavior. */
  settings?: ContentBriefSettings;
};

/**
 * ctx.brief's fields are raw, user-editable text (edited in
 * ContentBriefReview.tsx before this ever runs) interpolated directly
 * below. Accepted risk, not an oversight — same rationale as
 * content-brief.service.ts's buildPrompt: nothing generated from it is
 * ever persisted without an explicit human review + Save, and the system
 * prompt above already instructs the model not to invent facts.
 */
export function buildPrompt(ctx: LongFormContentContext, knowledgeSourceContext?: string | null): string {
  const settings = ctx.settings ?? DEFAULT_CONTENT_BRIEF_SETTINGS;
  const keywordLine = ctx.keyword
    ? `Target keyword: "${ctx.keyword.term}"${ctx.keyword.intent ? ` (tracked search intent: ${ctx.keyword.intent})` : ""}`
    : "No specific tracked keyword was selected — follow the brief's suggested search intent below.";

  // A weak/small fallback model reliably under-writes against a bare
  // "approximately N words" instruction with nothing anchoring it — the
  // per-section budget below is what actually connects the total target to
  // how much the model should write for each outline section.
  const outlineSectionCount = ctx.brief.outline.length || settings.outline.h2Count || 5;
  const perSectionWords = Math.round(settings.wordCount / outlineSectionCount);
  // A firm floor, not just a soft "roughly" target — a live test against this
  // exact prompt shape showed sections landing at ~60% of perSectionWords
  // even from a capable model. Deliberately not 100% of perSectionWords: the
  // floor must still leave room for a section that genuinely has less to
  // say than another without that reading as a violation.
  //
  // Phase 3B — perSectionWords is still computed (it's the basis for the
  // floor above) but is deliberately never surfaced to the model as an
  // explicit "up to roughly N words" ceiling. A live comparison against an
  // earlier prompt version that DID state that ceiling showed real output
  // dropping when the ceiling number was lowered, even though the floor was
  // simultaneously raised — evidence the model may anchor to a stated
  // per-section ceiling as a practical stopping point. This version tests
  // that hypothesis by removing the ceiling phrase, not by changing the
  // floor's math.
  const minSectionWords = Math.round(perSectionWords * 0.75);
  const { lowWords, highWords } = computeAcceptableRange(settings.wordCount);

  const requirements = [
    `1. An introduction that gives the reader a clear, useful answer or orientation to their main question within the first few sentences — not just a hook or a restatement of what the article covers. Do not end the introduction with generic template language such as "This comprehensive guide will walk you through...", "In this article, we'll explore...", "This guide covers...", or "Let's take a look at..." — every sentence in the introduction should add real orientation, context, or insight, not preview the article's structure.`,
    `2. ${outlineSectionCount} H2 sections following the brief's outline, in order, each with MULTIPLE substantive paragraphs (not a single short paragraph) — and a bulleted/numbered list where genuinely appropriate. Each section must contribute distinct information not covered elsewhere in the article — a concrete example, a specific process or step, a decision-making criterion, or a named consideration. Do not repeat the same general claim or benefit across multiple sections. If a section covers more than one sub-topic, organize it with \`###\`-style sub-headers within that section's body text. Develop each section as flowing prose built around its outline topic — never restate the outline point itself as a visible numbered fragment (e.g. "1.1", "2.3") or as a bare question-and-one-line-answer; the outline is planning structure for you alone, not text the reader sees. Where a section makes an important claim, state it plainly, ground it in whatever specific detail the supplied context actually provides, then explain what it means for the reader — do not manufacture evidence just to fill that shape.`,
    `3. This list of sections must contain ONLY ordinary content sections — never your own "Conclusion", "FAQ", "Key Takeaways", "Resources", or any other summary/structural section. Those are separate, dedicated fields this schema already provides elsewhere; do not duplicate them here.`,
    `4. If a section's heading (e.g. containing words like "Real-Life Examples", "Case Studies", "Success Stories", "Statistics", "Industry Examples", or a named company/project) implies a specific real-world example, statistic, or outcome, and the supplied context above does not actually contain that material, do not invent one. Instead, either explicitly label the illustration as hypothetical (e.g. "Consider a hypothetical scenario where...") or explain the underlying concept without presenting an invented example as fact. Never invent a company name, project name, case study, outcome, statistic, percentage, revenue figure, occupancy rate, or ROI number. Never use phrases like "one notable example," "a recent study," or "industry data shows" unless that supporting information is actually present in the supplied context above.`,
    "5. Internal-link placement suggestions: for each of the brief's internal-link suggestions, provide the recommended anchor text, a target page description, the reason it's relevant, and where in THIS article it should be placed (e.g. \"in the introduction\", \"after the second section\") — describe pages in words, never invent URLs that don't exist.",
  ];
  if (settings.sections.conclusion)
    requirements.push(
      "6. A conclusion that names 2-3 specific takeaways actually made earlier in this article (not a restatement of the section topics/headings) and reinforces the target keyword's intent. Do not introduce any new fact, statistic, example, or claim in the conclusion that wasn't already established earlier in the article. When a call-to-action is configured, end with a natural transition toward taking action, without writing the CTA copy itself."
    );
  if (settings.sections.faq)
    requirements.push(
      `7. A FAQ section of exactly ${settings.faqConfig.count} items, following the brief's FAQ suggestions — each answer must give a direct answer in the first sentence, then one to two sentences of concise explanation; never a one-word or single-phrase answer. Each answer must be understandable entirely on its own, without requiring the reader to have read the rest of the article.`
    );
  if (settings.sections.keyTakeaways)
    requirements.push(
      "8. A short list of key takeaways — each one a specific, decision-useful insight drawn from this article's actual content, not a statement generic enough to apply to any article on this topic."
    );
  if (settings.draftOptions.imagePlaceholders) requirements.push("9. A list of image placeholder descriptions (where an image should go and what it should show).");
  if (settings.draftOptions.altTextSuggestions) requirements.push("10. Suggested alt text for each image placeholder.");
  if (settings.draftOptions.featuredImagePrompt) requirements.push("11. A single descriptive prompt suitable for generating a featured image for this article.");
  if (settings.draftOptions.socialSnippets) requirements.push("12. Two or three short social-media post snippets promoting this article.");
  if (settings.draftOptions.excerpt) requirements.push("13. A one-to-two sentence excerpt/summary suitable for a blog listing page.");
  if (knowledgeSourceContext) {
    requirements.push(
      "14. sourcesReferenced: for each supplied authoritative source above that you actually drew from to support a specific claim in this article, list its exact supplied title and (if one was supplied) its exact supplied URL. Never invent a URL. Never list a source that was not supplied above. Never list a source merely because it seems topically relevant — this represents sources you actually used, not a list of potentially useful ones."
    );
  }

  const sharedContextClauses = buildSharedContextClauses(settings);

  return `Website: ${ctx.domain} (SEO project: ${ctx.seoProjectName})
${keywordLine}
${sharedContextClauses.length > 0 ? `${sharedContextClauses.join("\n")}\n` : ""}
This article's APPROVED BRIEF (already reviewed and approved by a human — follow it, do not deviate from its scope):
- Title: ${ctx.brief.title}
- Outline: ${ctx.brief.outline.join(" | ") || "(none)"}
- Suggested headings: ${ctx.brief.suggestedHeadings.join(" | ") || "(none)"}
- SEO recommendations to apply: ${ctx.brief.seoRecommendations.join(" | ") || "(none)"}
- GEO/AEO notes: ${ctx.brief.geoAeoNotes}
- Suggested search intent: ${ctx.brief.suggestedSearchIntent}

This article's target length is approximately ${settings.wordCount} words in total — a range of roughly ${lowWords}-${highWords} words is fine, and reaching it should be a natural consequence of genuine depth, not a goal pursued for its own sake. The outline above has ${outlineSectionCount} sections; each section must contain AT LEAST ${minSectionWords} words of real substance — meaningful explanation, evidence or context grounded in the information supplied above, examples, or analysis that make the section genuinely useful on its own, not a thin summary. There is no upper limit stated for a section — develop each one as fully as the supplied brief and context genuinely support, rather than stopping once the minimum is technically met. Falling far short of the target because sections are shallow is not acceptable. But do not pad with repetition, generic restatements, filler sentences, or invented information just to hit the number — if the supplied context does not support reaching the target without inventing unsupported material, prioritize accuracy and write a shorter, honest article instead.
Reading level: ${settings.readingLevel.toLowerCase().replace("_", " ")}. Brand voice/tone: ${settings.brandVoice.toLowerCase().replace(/_/g, " ")}.
${settings.sections.cta ? "A call-to-action belongs near the end of this piece. Do NOT write the CTA copy, button text, phone number, or URL yourself — it will be inserted separately from the requester's own literal, pre-approved text. Only account for its presence when structuring the article." : ""}
${knowledgeSourceContext ? `\n${knowledgeSourceContext}\n` : ""}
Using ONLY the information above, write a complete draft article with:
${requirements.join("\n")}

Do not restate the brief verbatim — write real prose. Do not add facts, numbers, dates, or claims that aren't already in the context above. Never include internal instructions, configuration labels, word-count targets, or any other generation parameter as literal text anywhere in the headings or body — these values guide you but must never appear as visible content. If a section would genuinely benefit from a comparison or structured breakdown, format it as a real Markdown table — never add one merely to look more structured.`;
}

/**
 * Phase 4 — bounded, deficit-aware length-control controller. Runs after the
 * initial generation, before the existing sanitizer cleanup, and only ever
 * touches sections[].body — introduction/conclusion/FAQ/keyTakeaways are
 * never read or written here. See long-form-content.service.test.ts for the
 * behavioral contract this is validated against.
 */
const HARD_SAFETY_CAP = 3;
/** A controller heuristic for section selection only — not a content-quality guarantee, and never a target the model is asked to hit. See Phase 4A's design report. */
const PER_SECTION_GAIN_ESTIMATE = 100;
/** A candidate must exceed the original section's word count by more than this to be accepted — filters out trivial/no-op rephrasings, not a quality bar. */
const MIN_WORD_INCREASE = 15;

const sectionExpansionSchema = zv4.object({
  expansions: zv4.array(zv4.object({ heading: zv4.string(), body: zv4.string() })),
});

/**
 * The expansion request's own prompt-builder, deliberately separate from
 * buildPrompt() above: this call is scoped to a handful of EXISTING sections
 * only, never the whole article, and must never ask for (or be able to
 * produce) a new section, heading, or topic. Reuses the same
 * LONG_FORM_SYSTEM_PROMPT (doctrine + anti-fabrication clauses) as the
 * system prompt — see generateLongFormContent's expansion call below.
 */
function buildExpansionPrompt(ctx: LongFormContentContext, sectionsToExpand: Array<{ heading: string; body: string }>): string {
  const keywordLine = ctx.keyword
    ? `Target keyword: "${ctx.keyword.term}"${ctx.keyword.intent ? ` (tracked search intent: ${ctx.keyword.intent})` : ""}`
    : "No specific tracked keyword was selected — follow the brief's suggested search intent below.";

  const sectionsBlock = sectionsToExpand
    .map((section, index) => `--- EXISTING SECTION ${index + 1} ---\nHeading: ${section.heading}\nExisting body (expand this — do not discard it):\n${section.body}`)
    .join("\n\n");

  return `Website: ${ctx.domain} (SEO project: ${ctx.seoProjectName})
${keywordLine}

This article's APPROVED BRIEF (already reviewed and approved by a human):
- Title: ${ctx.brief.title}
- SEO recommendations to apply: ${ctx.brief.seoRecommendations.join(" | ") || "(none)"}
- GEO/AEO notes: ${ctx.brief.geoAeoNotes}

The following ${sectionsToExpand.length} section(s) are EXISTING, already-generated parts of a longer article that is being reviewed for depth. For EACH one, return an expanded, deepened version of that exact section.

${sectionsBlock}

Requirements for every expansion, all of which are firm:
- Preserve the EXACT original heading text for each section, unchanged.
- Preserve everything useful the existing body already says — expand and deepen it, never discard or contradict correct existing content.
- Do not simply restate the existing section in different words — add genuinely new detail: further explanation, a concrete example, a specific process or step, a decision-making criterion, or analysis, grounded only in the information supplied above and in the existing section text.
- Use only information supported by the supplied brief/context above. Never invent a statistic, percentage, financial figure, study, case study, company name, testimonial, or other unsupported claim merely to make a section longer.
- Do not create any new section, heading, or topic. Return exactly one expansion per section listed above, in the same order, with the same heading.
- Do not reference or attempt to modify any other part of the article — the introduction, conclusion, FAQ, and key takeaways are not part of this request and are handled separately.
- If the supplied context genuinely does not support meaningfully expanding a section without inventing material, return that section with only the improvement the context actually supports. A short, honest expansion is better than a padded or fabricated one — do not add filler sentences just to increase length.`;
}

type ValidatedExpansion = { index: number; newBody: string; wordDelta: number };

function normalizeHeadingForMatch(heading: string): string {
  return heading.trim().toLowerCase();
}

/**
 * Deterministic validation — never prompt-only trust. Every rejection rule
 * here mirrors the Phase 4A design report exactly: unexpected/new headings,
 * duplicate headings (first occurrence wins), and any "expansion" that isn't
 * genuinely longer are all discarded before they can ever reach the merge
 * step, regardless of what the model's own response claims.
 */
function validateExpansions(
  requestedSections: Array<{ realIndex: number; heading: string; body: string }>,
  returnedExpansions: Array<{ heading?: unknown; body?: unknown }>
): ValidatedExpansion[] {
  const byNormalizedHeading = new Map<string, { realIndex: number; body: string }>();
  for (const section of requestedSections) {
    byNormalizedHeading.set(normalizeHeadingForMatch(section.heading), { realIndex: section.realIndex, body: section.body });
  }

  const validated: ValidatedExpansion[] = [];
  const consumedHeadings = new Set<string>();

  for (const candidate of returnedExpansions) {
    if (typeof candidate.heading !== "string" || typeof candidate.body !== "string") continue;
    const normalized = normalizeHeadingForMatch(candidate.heading);
    const match = byNormalizedHeading.get(normalized); // unexpected/new heading — reject
    if (!match) continue;
    if (consumedHeadings.has(normalized)) continue; // duplicate heading — first valid occurrence wins
    const wordDelta = computeWordCount(candidate.body) - computeWordCount(match.body);
    if (wordDelta <= MIN_WORD_INCREASE) continue; // not meaningfully longer — reject
    consumedHeadings.add(normalized);
    validated.push({ index: match.realIndex, newBody: candidate.body, wordDelta });
  }

  return validated;
}

/**
 * Overshoot protection: applies validated expansions smallest-increase-first,
 * recalculating the REAL total (via the same formatter+counter production
 * uses) after each one, and stops before any addition that would push the
 * total past highWords. Never mutates currentArticle — every candidate is a
 * new object; the caller only receives the result once this function
 * returns.
 */
function acceptSafeExpansions(currentArticle: LongFormContentOutput, validatedExpansions: ValidatedExpansion[], highWords: number): LongFormContentOutput {
  const sortedByDelta = [...validatedExpansions].sort((a, b) => a.wordDelta - b.wordDelta);
  let workingSections = currentArticle.sections;

  for (const expansion of sortedByDelta) {
    const candidateSections = workingSections.map((section, i) => (i === expansion.index ? { ...section, body: expansion.newBody } : section));
    const candidateArticle = { ...currentArticle, sections: candidateSections };
    const candidateTotal = computeWordCount(formatLongFormContentAsMarkdown(candidateArticle));
    if (candidateTotal > highWords) break; // sorted ascending — every remaining (larger) delta would overshoot too
    workingSections = candidateSections;
  }

  return { ...currentArticle, sections: workingSections };
}

/**
 * The bounded refinement loop itself. Re-measures and re-ranks sections
 * before every round (never reuses a stale selection across rounds), stops
 * the instant the article is already in range, and gives up gracefully —
 * returning the last known-good article — on an expansion-call failure or a
 * round that produces no valid expansions. Never more than
 * HARD_SAFETY_CAP additional AI calls, regardless of how large the deficit
 * is; the 5000-word tier is expected to still fall short of range after the
 * cap is reached (see Phase 4A's structural assessment) rather than forcing
 * more rounds to chase a number.
 */
async function refineArticleLength(ctx: LongFormContentContext, article: LongFormContentOutput, lowWords: number, highWords: number): Promise<LongFormContentOutput> {
  let currentArticle = article;

  for (let round = 0; round < HARD_SAFETY_CAP; round++) {
    const currentTotal = computeWordCount(formatLongFormContentAsMarkdown(currentArticle));
    if (currentTotal >= lowWords) break; // already in (or above) range — stop immediately, no further calls
    if (currentArticle.sections.length === 0) break;

    const deficit = lowWords - currentTotal;
    const numSectionsToExpand = Math.min(currentArticle.sections.length, Math.ceil(deficit / PER_SECTION_GAIN_ESTIMATE));
    if (numSectionsToExpand === 0) break;

    const weakestFirst = currentArticle.sections
      .map((section, index) => ({ realIndex: index, heading: section.heading, body: section.body, words: computeWordCount(section.body) }))
      .sort((a, b) => a.words - b.words)
      .slice(0, numSectionsToExpand);

    // Both a thrown error AND a resolved-but-malformed/missing `expansions`
    // array are treated as "this round produced nothing usable" — the whole
    // shape check happens inside the try so neither can escape as an
    // uncaught exception up through generateLongFormContent.
    let expansions: Array<{ heading?: unknown; body?: unknown }>;
    try {
      const expansionResult = await generateStructuredOutput(sectionExpansionSchema, {
        system: LONG_FORM_SYSTEM_PROMPT,
        prompt: buildExpansionPrompt(ctx, weakestFirst),
        maxTokens: 4000,
        taskType: "CONTENT_DRAFT",
        promptVersion: PROMPT_VERSION,
        seoProjectId: ctx.seoProjectId,
        companyId: ctx.companyId,
      });
      expansions = Array.isArray(expansionResult?.expansions) ? expansionResult.expansions : [];
    } catch {
      break; // expansion call failed — stop refinement, keep the last known-good article
    }

    const validated = validateExpansions(weakestFirst, expansions);
    if (validated.length === 0) continue; // no-op round — try again next round with a fresh selection, if any remain

    const candidateSections = currentArticle.sections.map((section, i) => {
      const match = validated.find((v) => v.index === i);
      return match ? { ...section, body: match.newBody } : section;
    });
    const candidateArticle = { ...currentArticle, sections: candidateSections };
    const candidateTotal = computeWordCount(formatLongFormContentAsMarkdown(candidateArticle));

    currentArticle = candidateTotal <= highWords ? candidateArticle : acceptSafeExpansions(currentArticle, validated, highWords);
  }

  return currentArticle;
}

/**
 * Mirrors content-brief.service.ts's pattern exactly: a thin prompt-builder
 * around the shared generateStructuredOutput orchestrator. No changes to
 * lib/ai/providers/* — still a single schema-validated JSON call, just
 * with a dynamically-narrowed, settings-driven schema instead of a fixed
 * one.
 */
export async function generateLongFormContent(ctx: LongFormContentContext, onChunk?: (event: StreamEvent) => void): Promise<LongFormContentOutput> {
  const settings = ctx.settings ?? DEFAULT_CONTENT_BRIEF_SETTINGS;
  const knowledgeSourceContext = await getKnowledgeSourceContextForSeoProject(ctx.seoProjectId);
  const schema = buildLongFormOutputSchema(settings.sections, settings.draftOptions, Boolean(knowledgeSourceContext));
  const options = {
    system: LONG_FORM_SYSTEM_PROMPT,
    prompt: buildPrompt(ctx, knowledgeSourceContext),
    maxTokens: 4000,
    taskType: "CONTENT_DRAFT" as const,
    promptVersion: PROMPT_VERSION,
    seoProjectId: ctx.seoProjectId,
    companyId: ctx.companyId,
  };
  // Phase 22 — onChunk present means the caller (the job runner, when
  // AI_STREAMING_ENABLED) wants live progress; generateStructuredOutput
  // itself is never touched, this just picks which orchestrator to call.
  const result = onChunk ? await generateStructuredOutputStreaming(schema, options, onChunk) : await generateStructuredOutput(schema, options);
  // Reparse through the canonical schema so every disabled-section field
  // gets its default rather than being undefined at runtime — see
  // content-brief.service.ts's identical comment.
  const parsed = longFormContentOutputSchema.parse(result);

  // Phase 4 — bounded, deficit-aware section-depth refinement. Runs only
  // when the initial article falls short of the configured range; a
  // healthy or already-long article (as most short targets are) triggers
  // zero additional calls. See refineArticleLength's own comment.
  const { lowWords, highWords } = computeAcceptableRange(settings.wordCount);
  const refined = await refineArticleLength(ctx, parsed, lowWords, highWords);

  // Deterministic cleanup for the classes of defect a prompt instruction
  // alone can't guarantee against — see content-sanitizer.ts. Headings are
  // cleaned BEFORE the reserved-section filter runs, so a leaked "1.
  // Conclusion" numbering artifact still normalizes to "conclusion" and
  // gets filtered, not left behind as a stray duplicate.
  const cleanedSections = refined.sections.map((section) => ({ ...section, heading: stripHtmlTags(stripConfigurationArtifacts(section.heading)) }));
  return {
    ...refined,
    introduction: stripConfigurationArtifacts(refined.introduction),
    sections: filterReservedSections(cleanedSections),
    faq: refined.faq.map((item) => ({ ...item, question: stripConfigurationArtifacts(item.question) })),
  };
}
