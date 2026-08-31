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
import { contentBriefOutputSchema, type ContentBriefOutput } from "@/features/ai-workspace/schemas/content-brief.schema";
import { externalSourceSchema, faqItemSchema, normalizeArray, normalizeInternalLinkSuggestions } from "@/features/ai-workspace/schemas/content-brief-output-builder";
import { contentBriefSettingsSchema, type ContentBriefSettings } from "@/features/ai-workspace/schemas/content-brief-settings.schema";
import { validateContentBriefJobInput, validateLongFormJobInput, validateSchemaMarkupJobInput } from "@/features/ai-workspace/schemas/ai-generation-job.schema";

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
 * SCHEMA_MARKUP_GENERATION added as the third AI Workspace tool, following
 * this exact same additive pattern.
 */
const TASK_HANDLERS: Partial<Record<AiTaskType, TaskHandler>> = {
  CONTENT_BRIEF: dispatchContentBrief,
  CONTENT_DRAFT: dispatchContentDraft,
  SCHEMA_MARKUP_GENERATION: dispatchSchemaMarkup,
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
