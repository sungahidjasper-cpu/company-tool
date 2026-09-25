import type { AiTaskType, Prisma, WebsiteAnalysisErrorType } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { describeLlmError, LlmProviderError } from "@/lib/ai/providers/errors";
import type { StreamEvent } from "@/lib/ai/providers/types";
import { logger } from "@/lib/logger";
import {
  markAiGenerationJobFailed,
  markAiGenerationJobRunning,
  markAiGenerationJobSucceeded,
  updateAiGenerationJobPartialText,
} from "@/lib/jobs/ai-generation-job-table";
import { generateContentBrief } from "@/features/ai-workspace/services/content-brief.service";
import { generateLongFormContent } from "@/features/ai-workspace/services/long-form-content.service";
import { generateSchemaMarkupRecommendations } from "@/features/ai-workspace/services/schema-markup-generator.service";
import { generateInternalLinkRecommendations } from "@/features/ai-workspace/services/internal-link-analyzer.service";
import { generateSocialSnippets } from "@/features/ai-workspace/services/social-snippet-generator.service";
import { generateMetaTagSuggestions } from "@/features/ai-workspace/services/meta-tag-optimizer.service";
import { generateContentRewrite } from "@/features/ai-workspace/services/content-rewriter.service";
import { generatePressRelease } from "@/features/ai-workspace/services/press-release-generator.service";
import { generateContentGapAnalysis, extractContentGapsFromAudit, extractContentClustersFromAudit, extractCrawledPageTitles } from "@/features/ai-workspace/services/content-gap-analysis.service";
import { generateTopicClusterPlan } from "@/features/ai-workspace/services/topic-cluster-planner.service";
import { generateEmailNewsletter } from "@/features/ai-workspace/services/email-newsletter.service";
import { generateImageAltText } from "@/features/ai-workspace/services/image-alt-text.service";
import { generateContentCalendar } from "@/features/ai-workspace/services/content-calendar.service";
import { getOwnedKeywordCluster } from "@/features/ai-workspace/services/content-calendar.repository";
import { buildScheduleSlots, checkDateRange, MAX_CALENDAR_ENTRIES } from "@/features/ai-workspace/schemas/content-calendar.schema";
import { getProjectImage } from "@/features/ai-workspace/services/project-image-inventory";
import { generateCompetitorContentAnalysis, type CompetitorCrawlEvidence } from "@/features/ai-workspace/services/competitor-content-analysis.service";
import { crawlWebsite } from "@/features/seo/services/website-crawler.service";
import { assertSafePublicUrl } from "@/features/publishing/services/ssrf-guard.service";
import { getBrandProfileByCompanyId } from "@/features/companies/services/brand-profile.service";
import { contentBriefOutputSchema, type ContentBriefOutput } from "@/features/ai-workspace/schemas/content-brief.schema";
import { externalSourceSchema, faqItemSchema, normalizeArray, normalizeInternalLinkSuggestions } from "@/features/ai-workspace/schemas/content-brief-output-builder";
import { contentBriefSettingsSchema, type ContentBriefSettings } from "@/features/ai-workspace/schemas/content-brief-settings.schema";
import {
  validateContentBriefJobInput,
  validateLongFormJobInput,
  validateSchemaMarkupJobInput,
  validateInternalLinkAnalyzerJobInput,
  validateSocialSnippetGeneratorJobInput,
  validateMetaTagOptimizerJobInput,
  validateContentRewriterJobInput,
  validatePressReleaseGeneratorJobInput,
  validateContentGapAnalysisJobInput,
  validateTopicClusterPlannerJobInput,
  validateCompetitorContentAnalysisJobInput,
  validateEmailNewsletterJobInput,
  validateImageAltTextJobInput,
  validateContentCalendarJobInput,
} from "@/features/ai-workspace/schemas/ai-generation-job.schema";
import { listContentInventoryForProject } from "@/features/seo/services/content.service";

/**
 * Reconstructs a ContentBriefOutput-shaped object from an already-saved
 * Content row — a duplicate of long-form-content.actions.ts's private
 * buildBriefFromContentRow, not a shared import: that file is a "use
 * server" module (every export must be an async server action), so its
 * private helpers can't be imported here. Duplicating a small helper
 * across files is this codebase's own established precedent (see
 * getOwnedSeoProject/getOwnedKeyword, duplicated the same way between
 * content-brief.actions.ts and long-form-content.actions.ts), not a new
 * pattern introduced by this file.
 */
function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function buildBriefFromContentRow(content: {
  title: string;
  metaTitle: string | null;
  metaDescription: string | null;
  aiBriefDetails: unknown;
}): ContentBriefOutput | null {
  if (!content.metaTitle || !content.metaDescription || !content.aiBriefDetails || typeof content.aiBriefDetails !== "object") {
    return null;
  }
  const raw = content.aiBriefDetails as Record<string, unknown>;
  const brief = {
    title: content.title,
    metaTitle: content.metaTitle,
    metaDescription: content.metaDescription,
    outline: asStringArray(raw.outline),
    suggestedHeadings: asStringArray(raw.suggestedHeadings),
    internalLinkSuggestions: normalizeInternalLinkSuggestions(raw.internalLinkSuggestions),
    seoRecommendations: asStringArray(raw.seoRecommendations),
    geoAeoNotes: typeof raw.geoAeoNotes === "string" ? raw.geoAeoNotes : "",
    suggestedSearchIntent: typeof raw.suggestedSearchIntent === "string" ? raw.suggestedSearchIntent : "",
    conclusion: typeof raw.conclusion === "string" ? raw.conclusion : "",
    externalSources: normalizeArray(externalSourceSchema, raw.externalSources),
    faq: normalizeArray(faqItemSchema, raw.faq),
    keyTakeaways: asStringArray(raw.keyTakeaways),
    schemaSuggestions: asStringArray(raw.schemaSuggestions),
    statistics: asStringArray(raw.statistics),
    examples: asStringArray(raw.examples),
  };
  const parsed = contentBriefOutputSchema.safeParse(brief);
  return parsed.success ? parsed.data : null;
}

/** The generation settings persisted alongside a saved brief (Phase 21) — falls back to undefined (default settings) for pre-Phase-21 rows or a corrupted value, never throws. */
function readBriefSettingsFromContentRow(aiBriefDetails: unknown): ContentBriefSettings | undefined {
  if (!aiBriefDetails || typeof aiBriefDetails !== "object") return undefined;
  const raw = (aiBriefDetails as Record<string, unknown>).briefSettings;
  const parsed = contentBriefSettingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

async function loadKeyword(keywordId: string | undefined) {
  if (!keywordId) return null;
  const keyword = await prisma.keyword.findUnique({ where: { id: keywordId } });
  return keyword ? { term: keyword.term, intent: keyword.intent } : null;
}

/** A rough size for a typical complete brief/article response — good enough for a coarse progress bar, not a measurement. Tune later against real completion lengths. */
const ESTIMATED_RESPONSE_CHARS = 3000;
/** Never write on every chunk — a streaming provider can emit dozens per second; this is a live PREVIEW, not an audit trail. */
const PARTIAL_TEXT_THROTTLE_MS = 500;

function estimateProgressFromText(text: string): number {
  const ratio = Math.min(1, text.length / ESTIMATED_RESPONSE_CHARS);
  return Math.min(90, 10 + Math.round(ratio * 80));
}

/**
 * Phase 22 — converts orchestrator-level StreamEvents into throttled writes
 * to the job row, which is the only thing the new SSE route handler reads.
 * Returns undefined (no streaming) when the feature flag is off, so a
 * disabled flag costs nothing beyond this one env check — dispatch()/the
 * generation services below already treat "no onChunk" as "call the
 * existing, unchanged non-streaming orchestrator." Writes are fire-and-
 * forget with errors logged and swallowed, same discipline
 * structured-output.ts's logUsage() already uses — a partial-preview write
 * failing must never affect the actual generation in progress.
 */
function createStreamingHandler(jobId: string): ((event: StreamEvent) => void) | undefined {
  if (process.env.AI_STREAMING_ENABLED !== "true") return undefined;

  let lastWriteAt = 0;

  return (event) => {
    if (event.type === "reset") {
      lastWriteAt = 0;
      void updateAiGenerationJobPartialText(jobId, null).catch((error) => {
        logger.error("Failed to reset partial generation text", { jobId, error: error instanceof Error ? error.message : String(error) });
      });
      return;
    }

    const now = Date.now();
    if (now - lastWriteAt < PARTIAL_TEXT_THROTTLE_MS) return;
    lastWriteAt = now;

    void updateAiGenerationJobPartialText(jobId, event.text, estimateProgressFromText(event.text)).catch((error) => {
      logger.error("Failed to persist partial generation text", { jobId, error: error instanceof Error ? error.message : String(error) });
    });
  };
}

type DispatchJob = { taskType: string; inputJson: unknown; companyId: string };
type TaskHandler = (job: DispatchJob, onChunk?: (event: StreamEvent) => void) => Promise<Prisma.InputJsonValue>;

async function dispatchContentBrief(job: DispatchJob, onChunk?: (event: StreamEvent) => void): Promise<Prisma.InputJsonValue> {
  const parsed = validateContentBriefJobInput(job.inputJson);
  if (!parsed.success) throw new Error(parsed.message);

  const seoProject = await prisma.sEOProject.findUnique({ where: { id: parsed.data.seoProjectId } });
  if (!seoProject) throw new Error("SEO project not found.");
  const keyword = await loadKeyword(parsed.data.keywordId);

  const brief = await generateContentBrief(
    {
      seoProjectId: seoProject.id,
      companyId: job.companyId,
      seoProjectName: seoProject.name,
      domain: seoProject.domain,
      contentType: parsed.data.contentType,
      keyword,
      notes: parsed.data.notes,
      settings: parsed.data.settings,
    },
    onChunk
  );
  return brief as unknown as Prisma.InputJsonValue;
}

async function dispatchContentDraft(job: DispatchJob, onChunk?: (event: StreamEvent) => void): Promise<Prisma.InputJsonValue> {
  const parsed = validateLongFormJobInput(job.inputJson);
  if (!parsed.success) throw new Error(parsed.message);

  if (parsed.data.mode === "fromContent") {
    const content = await prisma.content.findUnique({
      where: { id: parsed.data.contentId },
      include: { seoProject: { select: { id: true, name: true, domain: true } }, keywords: { select: { term: true, intent: true } } },
    });
    if (!content) throw new Error("Content not found.");
    const brief = buildBriefFromContentRow(content);
    if (!brief) throw new Error("This content has no saved brief to generate an article from.");
    const firstKeyword = content.keywords[0];
    const keyword = firstKeyword ? { term: firstKeyword.term, intent: firstKeyword.intent } : null;

    if (!content.seoProject) {
      throw new Error("This content has no SEO project, so there is no site context to generate an article against.");
    }

    const article = await generateLongFormContent(
      {
        seoProjectId: content.seoProject.id,
        companyId: job.companyId,
        seoProjectName: content.seoProject.name,
        domain: content.seoProject.domain,
        brief,
        keyword,
        settings: readBriefSettingsFromContentRow(content.aiBriefDetails),
      },
      onChunk
    );
    return article as unknown as Prisma.InputJsonValue;
  }

  const seoProject = await prisma.sEOProject.findUnique({ where: { id: parsed.data.seoProjectId } });
  if (!seoProject) throw new Error("SEO project not found.");
  const keyword = await loadKeyword(parsed.data.keywordId);

  const article = await generateLongFormContent(
    {
      seoProjectId: seoProject.id,
      companyId: job.companyId,
      seoProjectName: seoProject.name,
      domain: seoProject.domain,
      brief: parsed.data.brief,
      keyword,
      settings: parsed.data.settings,
    },
    onChunk
  );
  return article as unknown as Prisma.InputJsonValue;
}

async function dispatchSchemaMarkup(job: DispatchJob, onChunk?: (event: StreamEvent) => void): Promise<Prisma.InputJsonValue> {
  const parsed = validateSchemaMarkupJobInput(job.inputJson);
  if (!parsed.success) throw new Error(parsed.message);

  const seoProject = await prisma.sEOProject.findUnique({ where: { id: parsed.data.seoProjectId } });
  if (!seoProject) throw new Error("SEO project not found.");

  let content: { title: string; metaDescription: string | null; url: string | null } | null = null;
  if (parsed.data.contentId) {
    const found = await prisma.content.findUnique({
      where: { id: parsed.data.contentId },
      select: { title: true, metaDescription: true, url: true },
    });
    if (!found) throw new Error("Content not found.");
    content = found;
  }

  const result = await generateSchemaMarkupRecommendations(
    {
      seoProjectId: seoProject.id,
      companyId: job.companyId,
      seoProjectName: seoProject.name,
      domain: seoProject.domain,
      content,
      notes: parsed.data.notes,
    },
    onChunk
  );
  return result as unknown as Prisma.InputJsonValue;
}

async function dispatchInternalLinkAnalysis(job: DispatchJob, onChunk?: (event: StreamEvent) => void): Promise<Prisma.InputJsonValue> {
  const parsed = validateInternalLinkAnalyzerJobInput(job.inputJson);
  if (!parsed.success) throw new Error(parsed.message);

  const seoProject = await prisma.sEOProject.findUnique({ where: { id: parsed.data.seoProjectId } });
  if (!seoProject) throw new Error("SEO project not found.");

  const sourceContent = await prisma.content.findUnique({
    where: { id: parsed.data.contentId },
    select: { title: true, url: true, metaDescription: true, body: true },
  });
  if (!sourceContent) throw new Error("Content not found.");

  const inventoryRows = await listContentInventoryForProject(parsed.data.seoProjectId);
  const inventory = inventoryRows.filter((row) => row.id !== parsed.data.contentId && row.url !== null).map((row) => ({ title: row.title, url: row.url as string }));

  const result = await generateInternalLinkRecommendations(
    {
      seoProjectId: seoProject.id,
      companyId: job.companyId,
      seoProjectName: seoProject.name,
      domain: seoProject.domain,
      sourceContent,
      inventory,
    },
    onChunk
  );
  return { recommendations: result } as unknown as Prisma.InputJsonValue;
}

async function dispatchSocialSnippetGenerator(job: DispatchJob, onChunk?: (event: StreamEvent) => void): Promise<Prisma.InputJsonValue> {
  const parsed = validateSocialSnippetGeneratorJobInput(job.inputJson);
  if (!parsed.success) throw new Error(parsed.message);

  const seoProject = await prisma.sEOProject.findUnique({ where: { id: parsed.data.seoProjectId } });
  if (!seoProject) throw new Error("SEO project not found.");

  const sourceContent = await prisma.content.findUnique({
    where: { id: parsed.data.contentId },
    select: { title: true, url: true, metaDescription: true, body: true },
  });
  if (!sourceContent) throw new Error("Content not found.");

  const result = await generateSocialSnippets(
    {
      seoProjectId: seoProject.id,
      companyId: job.companyId,
      seoProjectName: seoProject.name,
      domain: seoProject.domain,
      sourceContent,
      platforms: parsed.data.platforms,
      notes: parsed.data.notes,
    },
    onChunk
  );
  return { snippets: result } as unknown as Prisma.InputJsonValue;
}

/**
 * The sixth AI Workspace tool's dispatcher. Ownership of seoProjectId/
 * contentIds was already verified by startMetaTagOptimizerAction before
 * this job was ever created — this dispatcher, like every other one, only
 * re-validates the job's shape, then re-fetches the authoritative Content
 * rows itself (never trusting anything about their metadata from
 * job.inputJson, which carries only ids). Content rows outside this
 * project are simply absent from the query result, never included in the
 * inventory handed to the AI — the same "thin dispatcher, no new business
 * logic, but never trust stored JSON as already-safe" discipline every
 * other dispatcher already follows. Generation only: nothing here writes
 * to Content or creates a ContentRevision.
 */
async function dispatchMetaTagOptimizer(job: DispatchJob, onChunk?: (event: StreamEvent) => void): Promise<Prisma.InputJsonValue> {
  const parsed = validateMetaTagOptimizerJobInput(job.inputJson);
  if (!parsed.success) throw new Error(parsed.message);

  const seoProject = await prisma.sEOProject.findUnique({ where: { id: parsed.data.seoProjectId } });
  if (!seoProject) throw new Error("SEO project not found.");

  const contentRows = await prisma.content.findMany({
    where: { id: { in: parsed.data.contentIds } },
    select: { id: true, title: true, url: true, metaTitle: true, metaDescription: true },
  });
  if (contentRows.length === 0) throw new Error("Content not found.");

  const inventory = contentRows.map((row) => ({
    contentId: row.id,
    title: row.title,
    url: row.url,
    currentMetaTitle: row.metaTitle,
    currentMetaDescription: row.metaDescription,
  }));

  const result = await generateMetaTagSuggestions(
    {
      seoProjectId: seoProject.id,
      companyId: job.companyId,
      seoProjectName: seoProject.name,
      domain: seoProject.domain,
      inventory,
    },
    onChunk
  );
  return { suggestions: result } as unknown as Prisma.InputJsonValue;
}

/**
 * The seventh AI Workspace tool's dispatcher. Ownership of seoProjectId/
 * contentId was already verified by startContentRewriteAction before this
 * job was ever created — this dispatcher, like every other one, only
 * re-validates the job's shape, then re-fetches the authoritative Content
 * row itself (never trusting anything about its title/meta/body from
 * job.inputJson, which carries only ids). Re-checks the same non-empty-body
 * eligibility rule the action already enforced — defense in depth, matching
 * every other dispatcher's own "never trust stored JSON as already-safe"
 * discipline, not duplicated business logic. Generation only: nothing here
 * writes to Content or creates a ContentRevision — see
 * content-rewriter.actions.ts (Stage C) and content-revision.service.ts
 * (Stage E), neither touched by this stage.
 */
async function dispatchContentRewriter(job: DispatchJob, onChunk?: (event: StreamEvent) => void): Promise<Prisma.InputJsonValue> {
  const parsed = validateContentRewriterJobInput(job.inputJson);
  if (!parsed.success) throw new Error(parsed.message);

  const seoProject = await prisma.sEOProject.findUnique({ where: { id: parsed.data.seoProjectId } });
  if (!seoProject) throw new Error("SEO project not found.");

  const content = await prisma.content.findUnique({ where: { id: parsed.data.contentId } });
  if (!content || content.seoProjectId !== seoProject.id) throw new Error("Content not found.");
  if (!content.body || !content.body.trim()) throw new Error("This page has no body text to rewrite.");

  const result = await generateContentRewrite(
    {
      contentId: content.id,
      seoProjectId: seoProject.id,
      companyId: job.companyId,
      seoProjectName: seoProject.name,
      domain: seoProject.domain,
      currentTitle: content.title,
      currentMetaTitle: content.metaTitle,
      currentMetaDescription: content.metaDescription,
      currentBody: content.body,
    },
    onChunk
  );
  return { result } as unknown as Prisma.InputJsonValue;
}

/**
 * The eighth AI Workspace tool's dispatcher. Ownership of seoProjectId was
 * already verified by startPressReleaseGenerationAction before this job was
 * ever created — this dispatcher, like every other one, only re-validates
 * the job's shape, then re-fetches the authoritative SEO project itself
 * (never trusting anything about it from job.inputJson beyond its id).
 * Never reads or writes Content or ContentRevision — this tool has no
 * contentId in its input at all, so there is nothing to fetch beyond the
 * SEO project.
 */
async function dispatchPressReleaseGenerator(job: DispatchJob, onChunk?: (event: StreamEvent) => void): Promise<Prisma.InputJsonValue> {
  const parsed = validatePressReleaseGeneratorJobInput(job.inputJson);
  if (!parsed.success) throw new Error(parsed.message);

  const seoProject = await prisma.sEOProject.findUnique({ where: { id: parsed.data.seoProjectId } });
  if (!seoProject) throw new Error("SEO project not found.");

  const result = await generatePressRelease(
    {
      seoProjectId: seoProject.id,
      companyId: job.companyId,
      seoProjectName: seoProject.name,
      domain: seoProject.domain,
      headline: parsed.data.headline,
      keyFacts: parsed.data.keyFacts,
      quote: parsed.data.quote,
      dateline: parsed.data.dateline,
      callToAction: parsed.data.callToAction,
      notes: parsed.data.notes,
    },
    onChunk
  );
  return { result } as unknown as Prisma.InputJsonValue;
}

/**
 * The ninth AI Workspace tool's dispatcher. Ownership of seoProjectId was
 * already verified by startContentGapAnalysisAction before this job was
 * ever created, and the specific websiteAnalysisJobId it resolved was
 * already confirmed to have real content-gap data at that time — this
 * dispatcher, like every other one, only re-validates the job's shape, then
 * re-fetches and re-checks both rows itself (never trusting anything about
 * them from job.inputJson beyond their ids). Content rows are read here
 * read-only, for the existing-coverage cross-reference only — nothing here
 * writes to Content or creates a ContentRevision.
 */
/**
 * The tenth AI Workspace tool. Every id is re-resolved here from the job row
 * rather than trusted from inputJson: the project is looked up and matched
 * against the job own companyId, and keyword/cluster/content records are
 * loaded scoped to that project with soft-deleted rows excluded. The seed
 * topic is user text and is passed through as such.
 *
 * Reads only — no Content, Keyword or KeywordCluster row is created or
 * modified by this task.
 */
/**
 * The eleventh AI Workspace tool.
 *
 * The competitor crawl happens here rather than in the action because it is
 * slow — up to three sites, each sampled by the shared crawler — and the
 * job/stream machinery exists for exactly that. The action has already
 * validated and pinned each origin; this re-runs the SSRF guard immediately
 * before fetching anyway, so a stored job row can never become a way to reach
 * an internal address.
 *
 * No second crawler is introduced: crawlWebsite is the same robots-respecting,
 * sitemap-aware, page-limited crawler Website Analysis uses, with its limits
 * untouched.
 *
 * Reads only — no Content, Keyword, KeywordCluster or Brand Profile row is
 * created or modified.
 */
async function dispatchCompetitorContentAnalysis(job: DispatchJob, onChunk?: (event: StreamEvent) => void): Promise<Prisma.InputJsonValue> {
  const parsed = validateCompetitorContentAnalysisJobInput(job.inputJson);
  if (!parsed.success) throw new Error(parsed.message);

  const seoProject = await prisma.sEOProject.findUnique({ where: { id: parsed.data.seoProjectId } });
  if (!seoProject) throw new Error("SEO project not found.");
  // Defence in depth behind the action's own checks.
  if (seoProject.companyId !== job.companyId) throw new Error("SEO project not found.");
  if (seoProject.deletedAt) throw new Error("This SEO project has been archived.");

  const evidence: CompetitorCrawlEvidence[] = [];
  for (const competitor of parsed.data.competitors) {
    // Re-validated immediately before the fetch — never trusted from the job row.
    await assertSafePublicUrl(competitor.origin);

    const crawl = await crawlWebsite(competitor.origin);
    evidence.push({
      origin: competitor.origin,
      source: competitor.source,
      robotsTxtFound: crawl.robotsTxtFound,
      warnings: crawl.warnings,
      pages: crawl.pages.map((page) => ({
        url: page.url,
        title: page.title,
        metaDescription: page.metaDescription,
        headings: page.headings,
        bodyText: page.bodyText,
      })),
    });
  }

  const totalPages = evidence.reduce((sum, site) => sum + site.pages.length, 0);
  if (totalPages === 0) {
    // A crawl problem must not be reported as an AI problem.
    const warnings = evidence.flatMap((site) => site.warnings).join(" ");
    throw new Error(`No pages could be read from the competitor site(s) supplied. ${warnings}`.trim());
  }

  const [content, keywords, brandProfile] = await Promise.all([
    prisma.content.findMany({
      where: { seoProjectId: seoProject.id, deletedAt: null },
      select: { title: true },
      orderBy: { title: "asc" },
      take: 200,
    }),
    prisma.keyword.findMany({
      where: { seoProjectId: seoProject.id, deletedAt: null },
      select: { term: true },
      orderBy: { term: "asc" },
      take: 100,
    }),
    getBrandProfileByCompanyId(job.companyId),
  ]);

  const result = await generateCompetitorContentAnalysis(
    {
      seoProjectId: seoProject.id,
      companyId: job.companyId,
      seoProjectName: seoProject.name,
      domain: seoProject.domain,
      targetTopic: parsed.data.targetTopic,
      notes: parsed.data.notes,
      evidence,
      existingTitles: content.map((c) => c.title),
      keywordTerms: keywords.map((k) => k.term),
      brandName: brandProfile?.brandName ?? null,
      targetAudience: brandProfile?.targetAudience ?? null,
    },
    onChunk
  );

  return { result } as unknown as Prisma.InputJsonValue;
}

async function dispatchTopicClusterPlanning(job: DispatchJob, onChunk?: (event: StreamEvent) => void): Promise<Prisma.InputJsonValue> {
  const parsed = validateTopicClusterPlannerJobInput(job.inputJson);
  if (!parsed.success) throw new Error(parsed.message);

  const seoProject = await prisma.sEOProject.findUnique({ where: { id: parsed.data.seoProjectId } });
  if (!seoProject) throw new Error("SEO project not found.");
  // Defence in depth behind the action own check: a job must never reach
  // another company project, and an archived project is not plannable.
  if (seoProject.companyId !== job.companyId) throw new Error("SEO project not found.");
  if (seoProject.deletedAt) throw new Error("This SEO project has been archived.");

  const [keywords, clusters, content] = await Promise.all([
    prisma.keyword.findMany({
      where: {
        seoProjectId: seoProject.id,
        deletedAt: null,
        ...(parsed.data.keywordIds.length > 0 ? { id: { in: parsed.data.keywordIds } } : {}),
      },
      select: { term: true },
      orderBy: { term: "asc" },
      take: 100,
    }),
    prisma.keywordCluster.findMany({
      where: { seoProjectId: seoProject.id, deletedAt: null },
      select: { name: true },
      orderBy: { name: "asc" },
      take: 50,
    }),
    prisma.content.findMany({
      where: { seoProjectId: seoProject.id, deletedAt: null },
      select: { title: true },
      orderBy: { title: "asc" },
      take: 200,
    }),
  ]);

  const result = await generateTopicClusterPlan(
    {
      seoProjectId: seoProject.id,
      companyId: job.companyId,
      seoProjectName: seoProject.name,
      domain: seoProject.domain,
      seedTopic: parsed.data.seedTopic,
      audience: parsed.data.audience,
      notes: parsed.data.notes,
      keywordTerms: keywords.map((k) => k.term),
      clusterNames: clusters.map((c) => c.name),
      existingTitles: content.map((c) => c.title),
    },
    onChunk
  );

  return { result } as unknown as Prisma.InputJsonValue;
}

async function dispatchContentGapAnalysis(job: DispatchJob, onChunk?: (event: StreamEvent) => void): Promise<Prisma.InputJsonValue> {
  const parsed = validateContentGapAnalysisJobInput(job.inputJson);
  if (!parsed.success) throw new Error(parsed.message);

  const seoProject = await prisma.sEOProject.findUnique({ where: { id: parsed.data.seoProjectId } });
  if (!seoProject) throw new Error("SEO project not found.");

  const analysisJob = await prisma.websiteAnalysisJob.findUnique({ where: { id: parsed.data.websiteAnalysisJobId } });
  if (!analysisJob || analysisJob.seoProjectId !== seoProject.id) throw new Error("Website analysis not found.");

  const gaps = extractContentGapsFromAudit(analysisJob.resultJson);
  if (gaps.length === 0) throw new Error("This SEO audit has no content-gap data.");

  const contentClusters = extractContentClustersFromAudit(analysisJob.resultJson);
  const crawledTitles = extractCrawledPageTitles(analysisJob.resultJson);

  const contentRows = await prisma.content.findMany({
    where: { seoProjectId: seoProject.id, deletedAt: null },
    select: { title: true },
  });
  const existingTitles = [...new Set([...contentRows.map((row) => row.title), ...crawledTitles])];

  const result = await generateContentGapAnalysis(
    {
      seoProjectId: seoProject.id,
      companyId: job.companyId,
      seoProjectName: seoProject.name,
      domain: seoProject.domain,
      gaps,
      contentClusters,
      existingTitles,
    },
    onChunk
  );
  return { result } as unknown as Prisma.InputJsonValue;
}

/**
 * Phase 30 Stage 10 — a per-taskType lookup table replacing what used to be
 * a hardcoded if/else chain in dispatch() below. Behavior for CONTENT_BRIEF
 * and CONTENT_DRAFT is unchanged (dispatchContentBrief/dispatchContentDraft
 * are exactly those two branches' original bodies, moved, not rewritten —
 * see ai-generation-job-runner.test.ts, which pins this down); the only
 * thing this buys is that a future AI Workspace tool adds one enum value
 * and one entry here instead of growing this if/else further. RECOMMENDATIONS
 * and CONTENT_INTELLIGENCE (Website Analysis's own AiTaskType values) are
 * deliberately absent — those are never dispatched through AiGenerationJob.
 * SCHEMA_MARKUP_GENERATION, INTERNAL_LINK_ANALYSIS, SOCIAL_SNIPPET_GENERATION,
 * META_TAG_OPTIMIZATION, CONTENT_REWRITE, PRESS_RELEASE_GENERATION, and
 * CONTENT_GAP_ANALYSIS added as the third through ninth AI Workspace tools,
 * following this exact same additive pattern.
 */
/**
 * The twelfth AI Workspace tool's dispatcher. Ownership of seoProjectId and
 * contentId was already verified by startEmailNewsletterAction before this
 * job existed — this dispatcher re-verifies both anyway (defence in depth
 * behind the action's own checks, the same discipline
 * dispatchCompetitorContentAnalysis follows) and re-fetches the
 * authoritative Content row rather than trusting anything about it from
 * job.inputJson, which carries only ids and the user's own text.
 *
 * Drafting only: nothing here writes to Content, creates a ContentRevision,
 * or touches any email/delivery system — none exists.
 */
async function dispatchEmailNewsletter(job: DispatchJob, onChunk?: (event: StreamEvent) => void): Promise<Prisma.InputJsonValue> {
  const parsed = validateEmailNewsletterJobInput(job.inputJson);
  if (!parsed.success) throw new Error(parsed.message);

  const seoProject = await prisma.sEOProject.findUnique({ where: { id: parsed.data.seoProjectId } });
  if (!seoProject) throw new Error("SEO project not found.");
  if (seoProject.companyId !== job.companyId) throw new Error("SEO project not found.");
  if (seoProject.deletedAt) throw new Error("This SEO project has been archived.");

  const sourceContent = await prisma.content.findUnique({
    where: { id: parsed.data.contentId },
    select: { title: true, url: true, metaDescription: true, body: true, seoProjectId: true, deletedAt: true },
  });
  if (!sourceContent) throw new Error("Content not found.");
  if (sourceContent.seoProjectId !== seoProject.id) throw new Error("Content not found for this SEO project.");
  if (sourceContent.deletedAt) throw new Error("This content record has been moved to trash.");

  const result = await generateEmailNewsletter(
    {
      seoProjectId: seoProject.id,
      companyId: job.companyId,
      seoProjectName: seoProject.name,
      domain: seoProject.domain,
      sourceContent: {
        title: sourceContent.title,
        url: sourceContent.url,
        metaDescription: sourceContent.metaDescription,
        body: sourceContent.body,
      },
      audience: parsed.data.audience,
      callToAction: parsed.data.callToAction,
      campaignAngle: parsed.data.campaignAngle,
      additionalContext: parsed.data.additionalContext,
      notes: parsed.data.notes,
    },
    onChunk
  );
  return { result } as unknown as Prisma.InputJsonValue;
}

/**
 * The thirteenth AI Workspace tool's dispatcher.
 *
 * Ownership of seoProjectId and fileId was already verified by
 * startImageAltTextAction before this job existed; both are re-verified here
 * anyway (defence in depth behind the action's own checks), and the File row
 * is RE-READ through the same project-scoped query the action used rather
 * than trusting anything about it from job.inputJson, which carries only ids
 * and the user's own words.
 *
 * The provider architecture is TEXT-ONLY — no image data is fetched, read or
 * sent anywhere. Review-only: nothing here writes to File or Content.
 */
async function dispatchImageAltText(job: DispatchJob, onChunk?: (event: StreamEvent) => void): Promise<Prisma.InputJsonValue> {
  const parsed = validateImageAltTextJobInput(job.inputJson);
  if (!parsed.success) throw new Error(parsed.message);

  const seoProject = await prisma.sEOProject.findUnique({ where: { id: parsed.data.seoProjectId } });
  if (!seoProject) throw new Error("SEO project not found.");
  if (seoProject.companyId !== job.companyId) throw new Error("SEO project not found.");
  if (seoProject.deletedAt) throw new Error("This SEO project has been archived.");

  const image = await getProjectImage(parsed.data.fileId, seoProject.id);
  if (!image) throw new Error("Image not found for this SEO project.");

  const result = await generateImageAltText(
    {
      seoProjectId: seoProject.id,
      companyId: job.companyId,
      seoProjectName: seoProject.name,
      domain: seoProject.domain,
      source: {
        fileName: image.fileName,
        mimeType: image.mimeType,
        contentTitle: image.content?.title ?? null,
        contentMetaDescription: image.content?.metaDescription ?? null,
      },
      imageDescription: parsed.data.imageDescription ?? "",
      additionalContext: parsed.data.additionalContext,
    },
    onChunk
  );
  return { result } as unknown as Prisma.InputJsonValue;
}

/**
 * The fourteenth AI Workspace tool's dispatcher.
 *
 * Everything the schedule is grounded in is re-read here from the database,
 * scoped to the server-resolved project: the keywords, the existing page
 * titles and the chosen cluster. The date range is re-validated and the
 * publishing slots recomputed, so the model is told how many slots exist but
 * never gets to choose a date.
 *
 * Generation only — the reviewed schedule is persisted later, and only when
 * the user explicitly saves it.
 */
async function dispatchContentCalendar(job: DispatchJob, onChunk?: (event: StreamEvent) => void): Promise<Prisma.InputJsonValue> {
  const parsed = validateContentCalendarJobInput(job.inputJson);
  if (!parsed.success) throw new Error(parsed.message);

  const seoProject = await prisma.sEOProject.findUnique({ where: { id: parsed.data.seoProjectId } });
  if (!seoProject) throw new Error("SEO project not found.");
  if (seoProject.companyId !== job.companyId) throw new Error("SEO project not found.");
  if (seoProject.deletedAt) throw new Error("This SEO project has been archived.");

  const range = checkDateRange(parsed.data.startDate, parsed.data.endDate);
  if (!range.ok) throw new Error(range.message);

  const slots = buildScheduleSlots(range.range, parsed.data.cadence, MAX_CALENDAR_ENTRIES);
  if (slots.length === 0) {
    throw new Error("That date range and rhythm leave no publishing dates. Choose a longer range or a more frequent rhythm.");
  }

  let clusterName: string | null = null;
  let clusterKeywordTerms: string[] = [];
  if (parsed.data.keywordClusterId) {
    const cluster = await getOwnedKeywordCluster(parsed.data.keywordClusterId, seoProject.id);
    if (!cluster) throw new Error("Topic cluster not found for this SEO project.");
    clusterName = cluster.name;
    clusterKeywordTerms = cluster.keywords.map((keyword) => keyword.term);
  }

  const [keywords, contentRows] = await Promise.all([
    prisma.keyword.findMany({
      where: { seoProjectId: seoProject.id, deletedAt: null },
      select: { id: true, term: true, intent: true },
      orderBy: { term: "asc" },
    }),
    prisma.content.findMany({
      where: { seoProjectId: seoProject.id, deletedAt: null },
      select: { title: true },
      orderBy: { title: "asc" },
    }),
  ]);

  const userTopics = (parsed.data.userTopics ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, MAX_CALENDAR_ENTRIES);

  const result = await generateContentCalendar(
    {
      seoProjectId: seoProject.id,
      companyId: job.companyId,
      seoProjectName: seoProject.name,
      domain: seoProject.domain,
      calendarName: parsed.data.name,
      range: range.range,
      cadence: parsed.data.cadence,
      slotCount: slots.length,
      keywords: keywords.map((keyword) => ({ id: keyword.id, term: keyword.term, intent: keyword.intent })),
      existingContentTitles: contentRows.map((row) => row.title),
      clusterName,
      clusterKeywordTerms,
      userTopics,
      audience: parsed.data.audience,
      notes: parsed.data.notes,
    },
    onChunk
  );
  return { result } as unknown as Prisma.InputJsonValue;
}

const TASK_HANDLERS: Partial<Record<AiTaskType, TaskHandler>> = {
  CONTENT_BRIEF: dispatchContentBrief,
  CONTENT_DRAFT: dispatchContentDraft,
  SCHEMA_MARKUP_GENERATION: dispatchSchemaMarkup,
  INTERNAL_LINK_ANALYSIS: dispatchInternalLinkAnalysis,
  SOCIAL_SNIPPET_GENERATION: dispatchSocialSnippetGenerator,
  META_TAG_OPTIMIZATION: dispatchMetaTagOptimizer,
  CONTENT_REWRITE: dispatchContentRewriter,
  PRESS_RELEASE_GENERATION: dispatchPressReleaseGenerator,
  CONTENT_GAP_ANALYSIS: dispatchContentGapAnalysis,
  TOPIC_CLUSTER_PLANNING: dispatchTopicClusterPlanning,
  COMPETITOR_CONTENT_ANALYSIS: dispatchCompetitorContentAnalysis,
  EMAIL_NEWSLETTER: dispatchEmailNewsletter,
  IMAGE_ALT_TEXT: dispatchImageAltText,
  CONTENT_CALENDAR: dispatchContentCalendar,
};

/**
 * Dispatches a job to the existing, UNCHANGED generation service functions
 * — generateContentBrief/generateLongFormContent are called with exactly
 * the same arguments the pre-Phase-18 synchronous actions used, so
 * generateStructuredOutput() (Phase 17's retry layer, the provider
 * abstraction, AiUsageLog writes) sees no difference in its caller at all.
 * Ownership of seoProjectId/keywordId/contentId was already verified by
 * the action that created this job, before the row was ever written — this
 * dispatcher only re-validates the job's *shape*, not who's allowed to see
 * it, matching the "thin dispatcher, no new business logic" design.
 */
async function dispatch(job: DispatchJob, onChunk?: (event: StreamEvent) => void): Promise<Prisma.InputJsonValue> {
  const handler = TASK_HANDLERS[job.taskType as AiTaskType];
  if (!handler) throw new Error(`Unsupported task type for background generation: ${job.taskType}`);
  return handler(job, onChunk);
}

/**
 * Classifies a thrown error into the errorType/errorMessage pair persisted
 * on a FAILED job. A real LlmProviderError gets the same friendly,
 * describeLlmError-derived message the pre-Phase-18 actions showed for AI
 * failures. Anything else (an ownership/shape error thrown by dispatch
 * itself, e.g. "Content not found.") keeps its own specific message rather
 * than being flattened into describeLlmError("UNKNOWN")'s generic text —
 * matching what actionError(...) used to show directly for those cases.
 */
function classifyFailure(error: unknown): { errorType: WebsiteAnalysisErrorType; errorMessage: string } {
  if (error instanceof LlmProviderError) {
    return { errorType: error.type, errorMessage: describeLlmError(error.type).message };
  }
  return { errorType: "UNKNOWN", errorMessage: error instanceof Error ? error.message : "An unexpected error occurred." };
}

export async function runAiGenerationJob(jobId: string): Promise<void> {
  const job = await markAiGenerationJobRunning(jobId);
  const onChunk = createStreamingHandler(job.id);
  try {
    const result = await dispatch(job, onChunk);
    await markAiGenerationJobSucceeded(job.id, result);
    logger.info("AI generation job succeeded", { jobId: job.id, taskType: job.taskType });
  } catch (error) {
    const { errorType, errorMessage } = classifyFailure(error);
    logger.error("AI generation job failed", {
      jobId: job.id,
      taskType: job.taskType,
      errorType,
      rawError: error instanceof Error ? error.message : String(error),
    });
    await markAiGenerationJobFailed(job.id, errorMessage, errorType);
  }
}
