import { z } from "zod";

import { optionalString, optionalUrl } from "@/lib/zod-helpers";

/** Every value the column can hold, including ones a user may not set by hand. */
export const CONTENT_STATUSES = [
  "DRAFT",
  "IN_REVIEW",
  "APPROVED",
  "SCHEDULED",
  "PUBLISHED",
  "ARCHIVED",
] as const;

/**
 * Linear order for the detail page's "Advance to next stage" affordance.
 *
 * SCHEDULED is deliberately ABSENT. That value is meaningless without a
 * scheduledAt and a scheduledTimezone, so stepping into it from a generic
 * "advance" button would produce a row claiming a publication time it does
 * not have. Scheduling is entered only through the explicit scheduling
 * action, which supplies both fields.
 */
export const CONTENT_STATUS_ORDER = [
  "DRAFT",
  "IN_REVIEW",
  "APPROVED",
  "PUBLISHED",
  "ARCHIVED",
] as const;

/**
 * The statuses a human may choose directly — in the edit form's dropdown and
 * in a CSV import. Same exclusion, same reason: neither carries a date, a
 * time or a zone, so neither can legitimately produce SCHEDULED.
 */
export const MANUALLY_SELECTABLE_CONTENT_STATUSES = CONTENT_STATUS_ORDER;

export type ContentStatusValue = (typeof CONTENT_STATUSES)[number];

/**
 * The next stage in the linear flow, or null when there is none.
 *
 * Returns null for SCHEDULED as well as for the final stage: a scheduled
 * record's next step is its schedule arriving or being cancelled, not a
 * status nudge. Without this, indexOf would return -1 and the caller would
 * silently offer to "advance" a scheduled record back to DRAFT.
 */
export function nextContentStatus(status: string): ContentStatusValue | null {
  const index = (CONTENT_STATUS_ORDER as readonly string[]).indexOf(status);
  if (index === -1) return null;
  return CONTENT_STATUS_ORDER[index + 1] ?? null;
}

export const contentSchema = z.object({
  title: z.string().min(2, "Title must be at least 2 characters"),
  url: optionalUrl(),
  status: z.enum(CONTENT_STATUSES),
  publishedAt: optionalString(),
  authorId: optionalString(),
  keywordIds: z.array(z.string()).optional(),
  /** Phase 16 — plain Markdown/text article body. Optional so manually-tracked content with no body yet is unaffected. */
  body: optionalString(),
});

export type ContentInput = z.infer<typeof contentSchema>;

/** One CSV row, before it's validated against contentSchema at import time. */
export const contentImportRowSchema = z.object({
  title: z.string().min(2),
  url: optionalUrl(),
  // Import may not set SCHEDULED: a CSV row carries no date, time or zone.
  status: z.enum(MANUALLY_SELECTABLE_CONTENT_STATUSES).optional().or(z.literal("")).transform((v) => v || "DRAFT"),
});

export type ContentImportRow = z.infer<typeof contentImportRowSchema>;
