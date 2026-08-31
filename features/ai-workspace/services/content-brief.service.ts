import type { BrandProfile } from "@/lib/generated/prisma/client";
import { generateStructuredOutput, generateStructuredOutputStreaming } from "@/lib/ai/structured-output";
import type { StreamEvent } from "@/lib/ai/providers/types";
import { buildContentBriefOutputSchema } from "@/features/ai-workspace/schemas/content-brief-output-builder";
import { buildSharedContextClauses, DEFAULT_CONTENT_BRIEF_SETTINGS, type ContentBriefSettings } from "@/features/ai-workspace/schemas/content-brief-settings.schema";
import { contentBriefOutputSchema, type ContentBriefOutput, type ContentBriefType } from "@/features/ai-workspace/schemas/content-brief.schema";
import { CONTENT_QUALITY_DOCTRINE } from "@/features/ai-workspace/services/content-quality-doctrine";
import { looksLikeInstructionEcho, stripConfigurationArtifacts, stripHtmlTags } from "@/features/ai-workspace/services/content-sanitizer";
import { getBrandProfileByCompanyId } from "@/features/companies/services/brand-profile.service";
import { getKnowledgeSourceContextForSeoProject } from "@/features/seo/services/knowledge-source-context.service";

/**
 * Bumped whenever the prompt template below changes — same convention as
 * seo-audit.service.ts's PROMPT_VERSION, though nothing currently caches
 * or reuses a prior CONTENT_BRIEF result by this value (no crawl-hash
 * equivalent exists for this task; every "Generate"/"Regenerate" click is
 * a fresh call).
 */
export const PROMPT_VERSION = 6;

export const CONTENT_BRIEF_SYSTEM_PROMPT = `${CONTENT_QUALITY_DOCTRINE} You are a senior SEO content strategist. Produce a practical, concrete content brief grounded strictly in the provided project/keyword context. Never invent products, services, or facts not evidenced in the input. Never state a specific market statistic, percentage, financial figure, or industry data point (e.g. occupancy rates, unit pricing, market share) unless it is present in the supplied context — describe such things qualitatively instead of inventing a number, including inside FAQ answers and statistic angles. Never characterize a specific real company or brand name as a generic category, product type, or common noun — if a real company name appears in the supplied context, refer to it accurately as a company/organization, not as a type of product or service. Never invent a URL, citation, or source you cannot verify — describe what kind of source to add instead. This is a BRIEF — outlines, headings, and suggestions, not a full drafted article body.`;

export type ContentBriefContext = {
  /** Provenance for the AiUsageLog row — the project this brief is for. Never a WebsiteAnalysisJob, since this task has none. */
  seoProjectId: string;
  /** Phase 19 — required for enforceCompanyAiLimits. */
  companyId: string;
  seoProjectName: string;
  domain: string;
  contentType: ContentBriefType;
  /** Null when the user generates from an ad-hoc topic (via notes) rather than an existing tracked keyword. */
  keyword: { term: string; intent: string | null } | null;
  notes?: string;
  /** Phase 21 — defaults to DEFAULT_CONTENT_BRIEF_SETTINGS when omitted, reproducing Phase 20's fixed-shape behavior exactly. */
  settings?: ContentBriefSettings;
};

const FAQ_STYLE_INSTRUCTIONS: Record<string, string> = {
  PEOPLE_ALSO_ASK: "phrased the way Google's 'People Also Ask' box phrases questions",
  CONVERSATIONAL: "phrased conversationally, the way a person would actually ask a voice assistant",
  SCHEMA_READY: "phrased and answered so they could be dropped directly into FAQPage schema markup with no editing",
};

/**
 * Appends one prompt clause per enabled toggle. Each function only ever
 * pushes lines — no restructuring of buildPrompt's overall shape, just a
 * longer, still-linear builder, matching the plan's own framing.
 */
function buildSettingsClauses(settings: ContentBriefSettings, brandProfile?: BrandProfile | null): string[] {
  const lines: string[] = [...buildSharedContextClauses(settings, brandProfile)];

  if (settings.existingUrl) {
    lines.push(
      `This brief is for OPTIMIZING an existing page at ${settings.existingUrl}, not writing brand-new content — frame the outline and recommendations as improvements to what likely already exists there.`
    );
  } else {
    lines.push("This brief is for writing brand-new content — there is no existing page to optimize.");
  }

  lines.push(`Target article length for the eventual draft: approximately ${settings.wordCount} words.`);
  lines.push(`Reading level: ${settings.readingLevel.toLowerCase().replace("_", " ")}.`);
  lines.push(`Brand voice/tone: ${settings.brandVoice.toLowerCase().replace(/_/g, " ")}.`);

  const outline = settings.outline;
  lines.push(
    `Outline structure: produce exactly ${outline.h2Count} top-level (H2) sections${outline.h3Count > 0 ? `, with roughly ${outline.h3Count} H3 subsections distributed across them` : ""}${outline.maxHeadingDepth === 2 ? " (H2 only — no nested subsections)" : ""}.`
  );
  if (outline.includeComparisonTable) lines.push("Include a comparison-table section in the outline (e.g. option A vs option B).");
  if (outline.includeChecklist) lines.push("Include a checklist-style section in the outline.");
  if (outline.includeNumberedProcess) lines.push("Include a numbered step-by-step process section in the outline.");
  if (outline.includeProsCons) lines.push("Include a pros/cons section in the outline.");

  if (settings.sections.faq) {
    const styleNote = FAQ_STYLE_INSTRUCTIONS[settings.faqConfig.style] ?? "";
    lines.push(`Produce exactly ${settings.faqConfig.count} FAQ items${styleNote ? `, ${styleNote}` : ""}.`);
  }
  if (settings.sections.cta) {
    lines.push(
      "A call-to-action belongs near the end of this piece. Do NOT write the CTA copy, button text, phone number, or URL yourself — that will be inserted separately by the requester's own literal, pre-approved text. Only account for its presence when structuring the outline."
    );
  }
  if (settings.sections.externalSources) {
    lines.push(
      "For external sources, suggest only a source TYPE and a real-world organization name that would plausibly publish this kind of information (e.g. 'CDC', 'Pew Research Center') plus why it's relevant. Never invent or guess a specific URL you cannot verify — describe the source, do not link to it."
    );
  }

  const q = settings.qualityControls;
  if (q.avoidCliches) lines.push("Avoid marketing clichés and generic filler phrasing.");
  if (q.avoidKeywordStuffing) lines.push("Integrate keywords naturally — do not keyword-stuff.");
  if (q.includeStatistics) lines.push("Suggest, in the statistics section, what kinds of statistics would strengthen this piece (do not invent actual numbers).");
  if (q.includeDefinitions) lines.push("Note where a clear definition of a key term would help both readers and AI answer engines.");
  if (q.includeEeatSignals) lines.push("Note concrete ways this piece could demonstrate Experience, Expertise, Authoritativeness, and Trust (EEAT).");
  if (q.optimizeForFeaturedSnippets) lines.push("Structure recommendations to make this content eligible for a featured snippet (concise direct-answer framing).");
  if (q.optimizeForAiOverviews) lines.push("Structure recommendations to make this content citable by AI Overviews / answer engines.");
  if (q.optimizeForGeo) lines.push("Include GEO (Generative Engine Optimization) recommendations.");
  if (q.optimizeForAeo) lines.push("Include AEO (Answer Engine Optimization) recommendations.");
  if (q.optimizeForSemanticSeo) lines.push("Include semantic SEO recommendations (related entities/topics to cover, not just the exact keyword).");

  return lines;
}

/**
 * ctx.notes is raw, unsanitized user text interpolated directly below.
 * Accepted risk, not an oversight: nothing generated from it is ever
 * persisted without an explicit human review + Save (see
 * content-brief.actions.ts's "approval gate"), and the system prompt
 * above already instructs the model not to invent facts — the human
 * review step is the actual mitigation for injected instructions, not a
 * sanitizer on this string.
 */
export function buildPrompt(ctx: ContentBriefContext, knowledgeSourceContext?: string | null, brandProfile?: BrandProfile | null): string {
  const settings = ctx.settings ?? DEFAULT_CONTENT_BRIEF_SETTINGS;
  const keywordLine = ctx.keyword
    ? `Target keyword: "${ctx.keyword.term}"${ctx.keyword.intent ? ` (tracked search intent: ${ctx.keyword.intent})` : ""}`
    : "No specific tracked keyword was selected — infer a sensible topic and target keyword from the notes below.";

  const requirements = [
    "1. A working title.",
    "2. A meta title of EXACTLY 50-60 characters (never shorter than 50, never longer than 60) and a meta description of EXACTLY 150-160 characters (never shorter than 150, never longer than 160). Count characters carefully before finalizing these two fields — these are hard SEO display limits, not approximations. When counting, count ONLY the visible words a reader would actually see in that field — never include the word-count target, character-count target, or any other configuration value as part of that count or as literal text within the field itself. For the meta description specifically, write one sentence stating what this content covers plus one sentence stating the concrete benefit or outcome for the reader — that two-sentence combination is what reaches 150-160 characters; a single short sentence will fall short.",
    "3. An outline (ordered list of section names) matching the outline structure below.",
    "4. A separate list of suggested subheadings within those sections.",
    "5. A short list of SEO recommendations specific to this piece (not generic advice).",
    "6. GEO/AEO notes: concrete suggestions for how this content could be structured to be cited by AI answer engines — e.g. an answer-then-evidence-then-explanation framing for key claims, specific and independently-understandable statements a search/AI system could quote directly, clear definitions, and structured lists.",
    "7. Your own suggested search intent for this piece (one of: informational, navigational, commercial, transactional), confirming or refining the tracked intent above if one was given.",
  ];
  if (settings.sections.internalLinks) requirements.push("8. Internal-link suggestions (anchor text, target page description, reason, placement, priority) — describe pages in words, never invent URLs that don't exist.");
  if (settings.sections.externalSources) requirements.push("9. External-source suggestions (type + real-world source name + description) — see the trust-boundary rule below.");
  if (settings.sections.faq) requirements.push("10. FAQ items per the count/style specified below.");
  if (settings.sections.conclusion) requirements.push("11. A short closing/conclusion note for the brief itself.");
  if (settings.sections.keyTakeaways) requirements.push("12. A short list of key takeaways.");
  if (settings.sections.schemaSuggestions) requirements.push("13. Suggested schema.org structured-data types this page should use (e.g. Article, FAQPage, HowTo).");
  if (settings.sections.statistics) requirements.push("14. A list of statistic ANGLES this piece should cite (topics/claims to support with data — not invented numbers).");
  if (settings.sections.examples) requirements.push("15. A list of concrete example ideas the draft could use to illustrate points.");
  if (settings.sections.cta) requirements.push("16. A ctaPlacementSuggestion: ONE sentence describing where/how a call-to-action should appear — never the CTA's actual copy, button text, phone number, or URL, which come from the requester's own pre-approved fields.");
  if (knowledgeSourceContext) {
    requirements.push(
      "17. sourcesReferenced: for each supplied authoritative source above that you actually drew from to support a specific claim in this brief, list its exact supplied title and (if one was supplied) its exact supplied URL. Never invent a URL. Never list a source that was not supplied above. Never list a source merely because it seems topically relevant — this represents sources you actually used, not a list of potentially useful ones."
    );
  }

  return `Website: ${ctx.domain} (SEO project: ${ctx.seoProjectName})
Content type: ${ctx.contentType}
${keywordLine}
${ctx.notes ? `Additional context/notes from the requester: ${ctx.notes}` : "No additional notes were provided."}

${buildSettingsClauses(settings, brandProfile).join("\n")}
${knowledgeSourceContext ? `\n${knowledgeSourceContext}\n` : ""}
Using ONLY the information above, produce a content brief with:
${requirements.join("\n")}

Never include internal instructions, configuration labels, word-count targets, character-count numbers, section-count settings, or any other generation parameter as literal text anywhere in the title, meta title, meta description, outline, or any other field — these values guide you but must never appear as visible content. For example, a target word count is information for you alone; it must never be appended to or quoted inside the title or meta title.`;
}

/**
 * Mirrors seo-audit.service.ts's one-function-per-task pattern exactly:
 * a thin prompt-builder around the shared generateStructuredOutput
 * orchestrator. No changes to lib/ai/providers/* — this is still a
 * schema-validated JSON call like every existing AI task, just with a
 * dynamically-narrowed, settings-driven schema instead of a fixed one.
 */
export async function generateContentBrief(ctx: ContentBriefContext, onChunk?: (event: StreamEvent) => void): Promise<ContentBriefOutput> {
  const settings = ctx.settings ?? DEFAULT_CONTENT_BRIEF_SETTINGS;
  const knowledgeSourceContext = await getKnowledgeSourceContextForSeoProject(ctx.seoProjectId);
  // Fetched here, not in the job runner or the action layer — same
  // service-internal-fetch precedent as knowledgeSourceContext above.
  // ctx.companyId is already trusted (derived from the authenticated actor
  // at job-creation time), so no additional ownership check is needed the
  // way getOwnedSeoProject needs one for a foreign, client-suppliable id.
  const brandProfile = await getBrandProfileByCompanyId(ctx.companyId);
  const schema = buildContentBriefOutputSchema(settings.sections, Boolean(knowledgeSourceContext));
  const options = {
    system: CONTENT_BRIEF_SYSTEM_PROMPT,
    prompt: buildPrompt(ctx, knowledgeSourceContext, brandProfile),
    maxTokens: 3000,
    taskType: "CONTENT_BRIEF" as const,
    promptVersion: PROMPT_VERSION,
    seoProjectId: ctx.seoProjectId,
    companyId: ctx.companyId,
  };
  // Phase 22 — onChunk present means the caller (the job runner, when
  // AI_STREAMING_ENABLED) wants live progress; generateStructuredOutput
  // itself is never touched, this just picks which orchestrator to call.
  const result = onChunk ? await generateStructuredOutputStreaming(schema, options, onChunk) : await generateStructuredOutput(schema, options);
  // The narrow per-request schema is always a subset of the canonical
  // ContentBriefOutput shape — reparsing through it fills in every
  // disabled-section field with its default ([] / "") so callers never see
  // an undefined array/string just because that section wasn't requested.
  const parsed = contentBriefOutputSchema.parse(result);
  // Deterministic cleanup for the classes of defect a prompt instruction
  // alone can't guarantee against — see content-sanitizer.ts. title is
  // cleaned first so it's ready as metaTitle's fallback below.
  const title = stripHtmlTags(stripConfigurationArtifacts(parsed.title));
  const cleanedMetaTitle = stripHtmlTags(stripConfigurationArtifacts(parsed.metaTitle));
  // If the whole metaTitle is echoed instruction text rather than a title,
  // there's no fragment worth salvaging — fall back to the already-clean
  // title field instead. No AI call, no regeneration; checkMetaLengths
  // still flags the fallback if it's outside 50-60 chars, same as always.
  const metaTitle = looksLikeInstructionEcho(cleanedMetaTitle) ? title : cleanedMetaTitle;
  const cleanedMetaDescription = stripHtmlTags(parsed.metaDescription);
  // metaDescription has no equivalent known-good field to fall back to, so
  // an echoed-instruction value is cleared to empty rather than left in
  // place — checkMetaLengths then honestly flags it TOO_SHORT (0 chars)
  // instead of silently showing garbled text.
  const metaDescription = looksLikeInstructionEcho(cleanedMetaDescription) ? "" : cleanedMetaDescription;
  return {
    ...parsed,
    title,
    metaTitle,
    metaDescription,
    outline: parsed.outline.map((heading) => stripHtmlTags(stripConfigurationArtifacts(heading))),
    suggestedHeadings: parsed.suggestedHeadings.map((heading) => stripHtmlTags(stripConfigurationArtifacts(heading))),
    faq: parsed.faq.map((item) => ({ ...item, question: stripConfigurationArtifacts(item.question) })),
  };
}
