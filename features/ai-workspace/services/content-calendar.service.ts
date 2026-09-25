import { generateStructuredOutput, generateStructuredOutputStreaming } from "@/lib/ai/structured-output";
import type { StreamEvent } from "@/lib/ai/providers/types";
import {
  buildScheduleSlots,
  CADENCE_LABELS,
  CALENDAR_CONTENT_TYPES,
  CALENDAR_ENTRY_ROLES,
  contentCalendarProviderOutputSchema,
  formatIsoDate,
  MAX_CALENDAR_ENTRIES,
  type CalendarCadence,
  type CalendarContentTypeValue,
  type CalendarEntryRoleValue,
  type ContentCalendarResult,
  type DateRange,
  type ProposedCalendarEntry,
} from "@/features/ai-workspace/schemas/content-calendar.schema";
import { CONTENT_QUALITY_DOCTRINE, SEO_METRIC_GROUNDING_GUARD } from "@/features/ai-workspace/services/content-quality-doctrine";
import { stripConfigurationArtifacts, stripHtmlTags, looksLikeInstructionEcho } from "@/features/ai-workspace/services/content-sanitizer";
import { containsFabricatedMetric, topicsSubstantiallyOverlap } from "@/features/ai-workspace/services/topic-cluster-planner.service";

/** Bumped whenever the prompt template below changes — same convention as every other AI Workspace service. */
export const PROMPT_VERSION = 1;

const MAX_OUTPUT_TOKENS = 4000;

/** One real keyword of the project, passed in by term and resolved back to its id in code. */
export type CalendarKeyword = { id: string; term: string; intent: string | null };

/** The real, project-scoped material the schedule is grounded in. */
export type ContentCalendarContext = {
  seoProjectId: string;
  companyId: string;
  seoProjectName: string;
  domain: string;
  calendarName: string;
  range: DateRange;
  cadence: CalendarCadence;
  slotCount: number;
  /** Real Keyword rows of this project. */
  keywords: CalendarKeyword[];
  /** Real Content titles of this project — used for overlap checks, never as topics. */
  existingContentTitles: string[];
  /** The chosen cluster's real name and its real keyword terms, when a cluster was chosen. */
  clusterName: string | null;
  clusterKeywordTerms: string[];
  /** Topics the user typed themselves, when they chose to supply their own. */
  userTopics: string[];
  audience?: string;
  notes?: string;
};

export const CONTENT_CALENDAR_SYSTEM_PROMPT = `${CONTENT_QUALITY_DOCTRINE} You are an SEO content strategist proposing the ORDER of a content plan.

You are NOT choosing dates. You will be told how many publishing slots exist; return at most that many items, in the order they should be published. The application assigns every real calendar date itself. Never write a date, a day, a week number, a month or a deadline anywhere in your output.

You must not invent identifiers of any kind. Do not return a content id, keyword id, cluster id or database id — you have not been given any, and any you produced would be fabricated. When a piece targets a keyword, name it using the EXACT keyword text supplied below and nothing else; if none of the supplied keywords genuinely fits, leave it empty rather than inventing one.

Ground every item in the material supplied below — the project's real keywords, its real existing page titles, the chosen cluster, and any topics the user typed. Never state a search volume, keyword difficulty, ranking, position, traffic figure, click count, impression count, conversion rate or competitor claim: no such data has been given to you, so any figure would be fabricated. Never promise that publishing something will improve rankings or traffic.

Give each item a clear role:
- PILLAR for a broad, foundational page a cluster is built around. A plan usually needs very few.
- SUPPORTING for a page that covers one part of a pillar's subject in depth.
- RELATED for a useful piece that stands on its own.

Do not plan two pieces that would compete for the same search intent with the same primary keyword. If two ideas overlap, either merge them into one better piece or make the relationship explicit — one pillar and one genuinely distinct supporting page. Prefer a smaller plan of distinct, useful pieces over a longer list that repeats itself.

Where the user supplied their own topics, those are the plan. Order them sensibly and add a piece of your own only if a slot would otherwise go unused.

${SEO_METRIC_GROUNDING_GUARD}`;

const clean = (text: string) => stripHtmlTags(stripConfigurationArtifacts(text));

/** Enum-validates a model-supplied content type; OTHER when it is not one of ours. Never guesses a specific type. */
export function normalizeCalendarContentType(value: unknown): CalendarContentTypeValue {
  if (typeof value !== "string") return "OTHER";
  const upper = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  return (CALENDAR_CONTENT_TYPES as readonly string[]).includes(upper) ? (upper as CalendarContentTypeValue) : "OTHER";
}

/** Enum-validates a model-supplied role. RELATED is the safe default — it claims no hierarchy. */
export function normalizeCalendarRole(value: unknown): CalendarEntryRoleValue {
  if (typeof value !== "string") return "RELATED";
  const upper = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  return (CALENDAR_ENTRY_ROLES as readonly string[]).includes(upper) ? (upper as CalendarEntryRoleValue) : "RELATED";
}

/**
 * Resolves a model-supplied keyword TERM back to a real Keyword row of this
 * project, by exact case-insensitive text match.
 *
 * Exact matching is deliberate. A fuzzy match would attach a page to a keyword
 * the user never chose, and a wrong keyword association is worse than none.
 */
export function resolveKeywordByTerm(term: unknown, keywords: readonly CalendarKeyword[]): CalendarKeyword | null {
  if (typeof term !== "string") return null;
  const needle = term.trim().toLowerCase();
  if (needle === "") return null;
  return keywords.find((keyword) => keyword.term.trim().toLowerCase() === needle) ?? null;
}

/**
 * Builds the reviewable schedule from model output.
 *
 * The important properties:
 * - Every date comes from `buildScheduleSlots`, so it is real and inside the
 *   range by construction. Item N takes slot N.
 * - Any model-supplied id is ignored entirely; keywords are re-resolved from
 *   their text against this project's real rows.
 * - Overlap between two planned topics, and between a planned topic and an
 *   existing page title, is FLAGGED and never silently removed — except for an
 *   exact duplicate topic, which is a duplicate row rather than a warning.
 * - A duplicate primary keyword across two entries is flagged, because that is
 *   the cannibalisation case that actually matters.
 */
export function buildContentCalendarResult(raw: unknown, ctx: ContentCalendarContext): ContentCalendarResult | null {
  if (!raw || typeof raw !== "object") return null;
  const payload = raw as Record<string, unknown>;
  if (!Array.isArray(payload.items)) return null;
  if (typeof payload.reasoning !== "string" || !payload.reasoning.trim()) return null;

  const slots = buildScheduleSlots(ctx.range, ctx.cadence, Math.min(ctx.slotCount, MAX_CALENDAR_ENTRIES));
  if (slots.length === 0) return null;

  type Staged = {
    topic: string;
    contentType: CalendarContentTypeValue;
    role: CalendarEntryRoleValue;
    keyword: CalendarKeyword | null;
    notes: string;
  };

  const staged: Staged[] = [];
  const seenTopics = new Set<string>();

  for (const item of payload.items) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.topic !== "string") continue;

    const topic = clean(candidate.topic);
    if (!topic.trim()) continue;
    // A metric claim in the topic itself is fabrication; drop the item.
    if (containsFabricatedMetric(topic) || looksLikeInstructionEcho(topic)) continue;

    // An exact repeat is a duplicate row, not a warning.
    const topicKey = topic.trim().toLowerCase().replace(/\s+/g, " ");
    if (seenTopics.has(topicKey)) continue;
    seenTopics.add(topicKey);

    const rawNotes = typeof candidate.notes === "string" ? clean(candidate.notes) : "";
    const notes = rawNotes && !containsFabricatedMetric(rawNotes) && !looksLikeInstructionEcho(rawNotes) ? rawNotes : "";

    staged.push({
      topic,
      contentType: normalizeCalendarContentType(candidate.contentType),
      role: normalizeCalendarRole(candidate.role),
      keyword: resolveKeywordByTerm(candidate.primaryKeywordTerm, ctx.keywords),
      notes,
    });
  }

  if (staged.length === 0) return null;

  // Slots are the hard limit — anything beyond them has nowhere real to sit.
  const scheduled = staged.slice(0, slots.length);
  const droppedForLackOfSlots = staged.length - scheduled.length;

  const entries: ProposedCalendarEntry[] = scheduled.map((item, index) => {
    const overlaps: string[] = [];

    // Against other planned topics.
    for (const [otherIndex, other] of scheduled.entries()) {
      if (otherIndex === index) continue;
      if (topicsSubstantiallyOverlap(item.topic, other.topic)) {
        overlaps.push(`Looks close to another planned piece: "${other.topic}".`);
        break;
      }
    }

    // Against the same primary keyword used elsewhere — the cannibalisation
    // case that matters most, and one the topic wording alone can hide.
    if (item.keyword) {
      const clash = scheduled.some((other, otherIndex) => otherIndex !== index && other.keyword?.id === item.keyword?.id);
      if (clash) overlaps.push(`Another planned piece also targets the keyword "${item.keyword.term}".`);
    }

    const existingContentTitle = ctx.existingContentTitles.find((title) => topicsSubstantiallyOverlap(item.topic, title)) ?? null;

    return {
      scheduledDate: formatIsoDate(slots[index]),
      topic: item.topic,
      contentType: item.contentType,
      role: item.role,
      keywordId: item.keyword?.id ?? null,
      keywordTerm: item.keyword?.term ?? null,
      notes: item.notes,
      overlapNote: overlaps.length > 0 ? overlaps.join(" ") : null,
      existingContentTitle,
    };
  });

  return {
    name: ctx.calendarName,
    startDate: formatIsoDate(ctx.range.start),
    endDate: formatIsoDate(ctx.range.end),
    cadence: ctx.cadence,
    entries,
    reasoning: payload.reasoning.trim(),
    droppedForLackOfSlots,
  };
}

/**
 * Builds the prompt, keeping real project data, the user's own input and the
 * request itself visibly separate.
 */
export function buildPrompt(ctx: ContentCalendarContext): string {
  const lines: string[] = [`Website: ${ctx.domain} (SEO project: ${ctx.seoProjectName})`];

  lines.push("\n=== THE REQUEST ===");
  lines.push(`Plan name: ${ctx.calendarName}`);
  lines.push(`Publishing rhythm: ${CADENCE_LABELS[ctx.cadence]}.`);
  lines.push(`Publishing slots available: ${ctx.slotCount}. Return at most ${ctx.slotCount} items, in publishing order. Do NOT write any dates.`);
  if (ctx.audience) lines.push(`Audience (the user's own words): ${ctx.audience}`);
  if (ctx.notes) lines.push(`Additional notes from the user: ${ctx.notes}`);

  if (ctx.userTopics.length > 0) {
    lines.push("\n=== TOPICS THE USER SUPPLIED (these are the plan — order them, do not replace them) ===");
    for (const topic of ctx.userTopics) lines.push(`- ${topic}`);
  }

  if (ctx.clusterName) {
    lines.push(`\n=== CHOSEN TOPIC CLUSTER (a real cluster in this project) ===`);
    lines.push(`Cluster: ${ctx.clusterName}`);
    if (ctx.clusterKeywordTerms.length > 0) {
      lines.push(`Keywords in this cluster: ${ctx.clusterKeywordTerms.join(", ")}`);
    } else {
      lines.push("This cluster has no keywords attached yet.");
    }
  }

  lines.push("\n=== REAL PROJECT KEYWORDS (the only keyword text you may use; no metrics are supplied) ===");
  if (ctx.keywords.length > 0) {
    for (const keyword of ctx.keywords.slice(0, 120)) {
      lines.push(keyword.intent ? `- ${keyword.term} (intent: ${keyword.intent})` : `- ${keyword.term}`);
    }
  } else {
    lines.push("(this project has no keywords yet — leave primaryKeywordTerm empty for every item)");
  }

  lines.push("\n=== PAGES THIS PROJECT ALREADY HAS (do not re-plan these; a close overlap is a reason to plan something else) ===");
  if (ctx.existingContentTitles.length > 0) {
    for (const title of ctx.existingContentTitles.slice(0, 80)) lines.push(`- ${title}`);
  } else {
    lines.push("(no pages yet)");
  }

  return `${lines.join("\n")}

Return an object with:
1. items: an array of at most ${ctx.slotCount} planned pieces, IN PUBLISHING ORDER. Each item has:
   - topic: what the piece is about, as a clear working title.
   - contentType: one of ARTICLE, GUIDE, LANDING_PAGE, FAQ_PAGE, CASE_STUDY, COMPARISON, OTHER.
   - role: PILLAR, SUPPORTING or RELATED.
   - primaryKeywordTerm: the exact text of one supplied keyword, or an empty string if none genuinely fits.
   - rationale: one sentence on why this piece is worth publishing.
   - notes: anything useful for whoever writes it, or an empty string.
2. reasoning: two or three sentences for the reviewer on how the plan is sequenced. This is not saved.

No dates. No ids. No invented keywords. No metrics, rankings or traffic claims.`;
}

/**
 * The generation wrapper — the shared orchestrator, no new AI client, no
 * provider bypass.
 *
 * Generation only: this produces a schedule for the user to review. Nothing is
 * written until they explicitly save it through saveContentCalendarAction.
 */
export async function generateContentCalendar(ctx: ContentCalendarContext, onChunk?: (event: StreamEvent) => void): Promise<ContentCalendarResult | null> {
  const options = {
    system: CONTENT_CALENDAR_SYSTEM_PROMPT,
    prompt: buildPrompt(ctx),
    maxTokens: MAX_OUTPUT_TOKENS,
    taskType: "CONTENT_CALENDAR" as const,
    promptVersion: PROMPT_VERSION,
    seoProjectId: ctx.seoProjectId,
    companyId: ctx.companyId,
  };
  const result = onChunk
    ? await generateStructuredOutputStreaming(contentCalendarProviderOutputSchema, options, onChunk)
    : await generateStructuredOutput(contentCalendarProviderOutputSchema, options);
  const parsed = contentCalendarProviderOutputSchema.parse(result);
  return buildContentCalendarResult(parsed, ctx);
}
