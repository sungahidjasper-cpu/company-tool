import { z } from "zod";
import { z as zv4 } from "zod/v4";

import { optionalString } from "@/lib/zod-helpers";

/** Mirrors the Prisma enums so the client and the AI layer share one vocabulary. */
export const CALENDAR_CONTENT_TYPES = ["ARTICLE", "GUIDE", "LANDING_PAGE", "FAQ_PAGE", "CASE_STUDY", "COMPARISON", "OTHER"] as const;
export type CalendarContentTypeValue = (typeof CALENDAR_CONTENT_TYPES)[number];

export const CALENDAR_ENTRY_ROLES = ["PILLAR", "SUPPORTING", "RELATED"] as const;
export type CalendarEntryRoleValue = (typeof CALENDAR_ENTRY_ROLES)[number];

export const CALENDAR_ENTRY_STATUSES = ["PLANNED", "BRIEF_CREATED", "DRAFT", "IN_PROGRESS", "PUBLISHED", "COMPLETED"] as const;
export type CalendarEntryStatusValue = (typeof CALENDAR_ENTRY_STATUSES)[number];

/**
 * How often a piece is planned. The user chooses this, and the application
 * turns it into real dates — which is what keeps every stored date correct by
 * construction rather than by trusting model output.
 */
export const CALENDAR_CADENCES = ["TWICE_WEEKLY", "WEEKLY", "FORTNIGHTLY", "MONTHLY"] as const;
export type CalendarCadence = (typeof CALENDAR_CADENCES)[number];

export const CADENCE_LABELS: Record<CalendarCadence, string> = {
  TWICE_WEEKLY: "Twice a week",
  WEEKLY: "Once a week",
  FORTNIGHTLY: "Every two weeks",
  MONTHLY: "Once a month",
};

/** Days between consecutive slots. Monthly is handled by calendar month, not by this number. */
const CADENCE_DAY_STEP: Record<CalendarCadence, number> = {
  TWICE_WEEKLY: 3,
  WEEKLY: 7,
  FORTNIGHTLY: 14,
  MONTHLY: 0,
};

/** Where topics come from. Determines what the generator is grounded in. */
export const CALENDAR_TOPIC_SOURCES = ["PROJECT_DATA", "USER_TOPICS", "TOPIC_CLUSTER"] as const;
export type CalendarTopicSource = (typeof CALENDAR_TOPIC_SOURCES)[number];

export const MAX_CALENDAR_ENTRIES = 40;
export const MAX_CALENDAR_RANGE_DAYS = 400;

// ---------------------------------------------------------------------------
// Date handling — entirely deterministic, and the reason no AI-supplied date
// ever reaches the database.
// ---------------------------------------------------------------------------

/** `yyyy-MM-dd`, the exact shape an `<input type="date">` produces and consumes. */
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a yyyy-MM-dd date");

/**
 * Parses `yyyy-MM-dd` to UTC midnight, or null when it is not a real calendar
 * date.
 *
 * The round-trip check is what rejects an impossible date: `2026-02-30` parses
 * to 2 March in every Date implementation, so comparing the formatted result
 * against the input is the only reliable way to catch it. UTC midnight is used
 * throughout so a stored date can never shift a day across timezones.
 */
export function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

/** Formats a Date back to `yyyy-MM-dd` in UTC. */
export function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export type DateRange = { start: Date; end: Date };

export type DateRangeCheck = { ok: true; range: DateRange; days: number } | { ok: false; message: string };

/**
 * The single date-range rule, shared by the picker and the server so the
 * button and the boundary cannot disagree.
 */
export function checkDateRange(startInput: string, endInput: string): DateRangeCheck {
  const start = parseIsoDate(startInput);
  if (!start) return { ok: false, message: "The start date is not a real date." };
  const end = parseIsoDate(endInput);
  if (!end) return { ok: false, message: "The end date is not a real date." };
  if (end.getTime() < start.getTime()) return { ok: false, message: "The end date cannot be before the start date." };

  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (days > MAX_CALENDAR_RANGE_DAYS) {
    return { ok: false, message: `A calendar can cover at most ${MAX_CALENDAR_RANGE_DAYS} days. Choose a shorter range.` };
  }
  return { ok: true, range: { start, end }, days };
}

/** True when the date falls inside the inclusive range. */
export function isWithinRange(date: Date, range: DateRange): boolean {
  return date.getTime() >= range.start.getTime() && date.getTime() <= range.end.getTime();
}

/**
 * Builds the publishing slots for a range and cadence — the list of real dates
 * a plan can use.
 *
 * This is why the AI is never asked for a date: it proposes an ORDER, and
 * position N in that order takes slot N here. A slot list that runs out simply
 * limits how many entries the plan can hold, which is honest; it never invents
 * a date outside the range.
 */
export function buildScheduleSlots(range: DateRange, cadence: CalendarCadence, limit = MAX_CALENDAR_ENTRIES): Date[] {
  const slots: Date[] = [];

  if (cadence === "MONTHLY") {
    const cursor = new Date(range.start.getTime());
    while (slots.length < limit && cursor.getTime() <= range.end.getTime()) {
      slots.push(new Date(cursor.getTime()));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return slots;
  }

  const step = CADENCE_DAY_STEP[cadence];
  for (let offset = 0; slots.length < limit; offset += step) {
    const slot = new Date(range.start.getTime() + offset * 86_400_000);
    if (slot.getTime() > range.end.getTime()) break;
    slots.push(slot);
  }
  return slots;
}

// ---------------------------------------------------------------------------
// Generation input
// ---------------------------------------------------------------------------

/**
 * The generation-form input.
 *
 * Dates arrive as `yyyy-MM-dd` strings, never as Date objects: a server action
 * receives whatever the client sends, and a string that has to survive
 * parseIsoDate is far safer than a value that merely claims to be a date.
 */
export const contentCalendarInputSchema = z
  .object({
    seoProjectId: z.string().min(1, "Select an SEO project").uuid("Invalid SEO project id"),
    name: z.string().trim().min(1, "Give the calendar a name").max(120, "Keep the calendar name under 120 characters"),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    cadence: z.enum(CALENDAR_CADENCES),
    topicSource: z.enum(CALENDAR_TOPIC_SOURCES),
    /** Used when topicSource is USER_TOPICS — one topic per line. */
    userTopics: z.string().max(4000, "Keep the topic list under 4000 characters").optional(),
    /** Used when topicSource is TOPIC_CLUSTER — a real KeywordCluster of this project. */
    keywordClusterId: z.string().uuid("Invalid cluster id").optional(),
    audience: optionalString(),
    notes: optionalString(),
  })
  .superRefine((value, ctx) => {
    const range = checkDateRange(value.startDate, value.endDate);
    if (!range.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endDate"], message: range.message });
    }
    if (value.topicSource === "USER_TOPICS" && (value.userTopics ?? "").trim().length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["userTopics"], message: "List at least one topic, one per line." });
    }
    if (value.topicSource === "TOPIC_CLUSTER" && !value.keywordClusterId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["keywordClusterId"], message: "Choose a topic cluster." });
    }
  });
export type ContentCalendarInput = z.infer<typeof contentCalendarInputSchema>;

/** The stored job input — the same shape. Ids and the user's own words only. */
export const contentCalendarJobInputSchema = contentCalendarInputSchema;
export type ContentCalendarJobInput = z.infer<typeof contentCalendarJobInputSchema>;

// ---------------------------------------------------------------------------
// Provider output — deliberately loose, and deliberately date-free
// ---------------------------------------------------------------------------

/**
 * What the model is asked for. Note what is ABSENT: no date, no contentId, no
 * keywordId, no clusterId, no status. The model proposes what to write and in
 * what order; the application decides everything else.
 */
export const calendarProposalItemSchema = zv4.object({
  topic: zv4.string(),
  contentType: zv4.string().nullable(),
  role: zv4.string().nullable(),
  /** Which supplied keyword term this piece targets, by TERM — never by id. */
  primaryKeywordTerm: zv4.string().nullable(),
  rationale: zv4.string(),
  notes: zv4.string().default(""),
});

export const contentCalendarProviderOutputSchema = zv4.object({
  items: zv4.array(calendarProposalItemSchema).default([]),
  reasoning: zv4.string(),
});
export type ContentCalendarProviderOutput = zv4.infer<typeof contentCalendarProviderOutputSchema>;

// ---------------------------------------------------------------------------
// Canonical result — a reviewable draft schedule, not yet saved
// ---------------------------------------------------------------------------

/**
 * One proposed entry, after the application has attached a real date and
 * resolved any keyword to a real project record.
 *
 * `keywordId` is present only when a supplied term matched a real Keyword of
 * this project; it is resolved in code from the term, never taken from output.
 */
export const proposedCalendarEntrySchema = zv4.object({
  scheduledDate: zv4.string(),
  topic: zv4.string(),
  contentType: zv4.enum(CALENDAR_CONTENT_TYPES),
  role: zv4.enum(CALENDAR_ENTRY_ROLES),
  keywordId: zv4.string().nullable(),
  keywordTerm: zv4.string().nullable(),
  notes: zv4.string(),
  /** Deterministic "this looks close to something else" note. Never a ranking claim. */
  overlapNote: zv4.string().nullable(),
  /** Set when the topic looks close to an EXISTING page's title. A title match only. */
  existingContentTitle: zv4.string().nullable(),
});
export type ProposedCalendarEntry = zv4.infer<typeof proposedCalendarEntrySchema>;

export const contentCalendarResultSchema = zv4.object({
  name: zv4.string(),
  startDate: zv4.string(),
  endDate: zv4.string(),
  cadence: zv4.enum(CALENDAR_CADENCES),
  entries: zv4.array(proposedCalendarEntrySchema),
  reasoning: zv4.string(),
  /** Reported honestly when the range and cadence hold fewer slots than there were topics. */
  droppedForLackOfSlots: zv4.number(),
});
export type ContentCalendarResult = zv4.infer<typeof contentCalendarResultSchema>;

export const contentCalendarJobResultSchema = zv4.object({ result: contentCalendarResultSchema.nullable() });
export type ContentCalendarJobResult = zv4.infer<typeof contentCalendarJobResultSchema>;

// ---------------------------------------------------------------------------
// Save input — what the user actually approved, after editing
// ---------------------------------------------------------------------------

/**
 * The save payload. Every field the user can edit in review is here, and every
 * one is re-validated server-side: the reviewed draft is client state by the
 * time it comes back, so none of it is trusted.
 */
/** Standalone so the status-update action can validate a status on its own — saveContentCalendarSchema is a refined effect and has no `.shape`. */
export const calendarEntryStatusSchema = z.enum(CALENDAR_ENTRY_STATUSES);

export const saveCalendarEntrySchema = z.object({
  scheduledDate: isoDateSchema,
  topic: z.string().trim().min(1, "Every entry needs a topic").max(300, "Keep topics under 300 characters"),
  contentType: z.enum(CALENDAR_CONTENT_TYPES),
  role: z.enum(CALENDAR_ENTRY_ROLES),
  status: z.enum(CALENDAR_ENTRY_STATUSES).default("PLANNED"),
  keywordId: z.string().uuid("Invalid keyword id").nullable().optional(),
  contentId: z.string().uuid("Invalid content id").nullable().optional(),
  notes: z.string().max(2000, "Keep entry notes under 2000 characters").optional(),
});
export type SaveCalendarEntryInput = z.infer<typeof saveCalendarEntrySchema>;

export const saveContentCalendarSchema = z
  .object({
    seoProjectId: z.string().min(1, "Select an SEO project").uuid("Invalid SEO project id"),
    name: z.string().trim().min(1, "Give the calendar a name").max(120, "Keep the calendar name under 120 characters"),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    keywordClusterId: z.string().uuid("Invalid cluster id").nullable().optional(),
    notes: optionalString(),
    entries: z.array(saveCalendarEntrySchema).min(1, "A calendar needs at least one entry").max(MAX_CALENDAR_ENTRIES, `A calendar can hold at most ${MAX_CALENDAR_ENTRIES} entries`),
  })
  .superRefine((value, ctx) => {
    const range = checkDateRange(value.startDate, value.endDate);
    if (!range.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endDate"], message: range.message });
      return;
    }

    const seenSlots = new Set<string>();
    const seenTopics = new Set<string>();
    value.entries.forEach((entry, index) => {
      const date = parseIsoDate(entry.scheduledDate);
      if (!date) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["entries", index, "scheduledDate"], message: "That is not a real date." });
        return;
      }
      if (!isWithinRange(date, range.range)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entries", index, "scheduledDate"],
          message: "That date is outside the calendar's range.",
        });
      }

      // The same topic twice is a planning mistake, not a schedule.
      const topicKey = entry.topic.trim().toLowerCase().replace(/\s+/g, " ");
      if (seenTopics.has(topicKey)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["entries", index, "topic"], message: "This topic is already on the calendar." });
      }
      seenTopics.add(topicKey);

      // The same topic on the same day is a duplicate row; two DIFFERENT
      // topics sharing a date is legitimate and allowed.
      const slotKey = `${entry.scheduledDate}::${topicKey}`;
      if (seenSlots.has(slotKey)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["entries", index, "scheduledDate"], message: "This entry is scheduled twice." });
      }
      seenSlots.add(slotKey);
    });
  });
export type SaveContentCalendarInput = z.infer<typeof saveContentCalendarSchema>;

/** Shown when a project has no keywords, clusters or content to plan from and the user supplied no topics either. */
export const NO_TOPIC_SOURCE_MESSAGE =
  "There is nothing to build a schedule from yet. Add keywords or content to this project, or type your own topics below.";

/** Shown when generation completes but produces no usable schedule. */
export const CALENDAR_NULL_RESULT_MESSAGE =
  "No usable schedule came back this time — the response didn't meet our requirements. Please try generating again.";
