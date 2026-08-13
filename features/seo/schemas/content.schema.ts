import { z } from "zod";

import { optionalString, optionalUrl } from "@/lib/zod-helpers";

export const CONTENT_STATUSES = [
  "DRAFT",
  "IN_REVIEW",
  "APPROVED",
  "PUBLISHED",
  "ARCHIVED",
] as const;

/** Linear order for the detail page's "Advance to next stage" affordance — the plain status dropdown stays freely editable. */
export const CONTENT_STATUS_ORDER = CONTENT_STATUSES;

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
  status: z.enum(CONTENT_STATUSES).optional().or(z.literal("")).transform((v) => v || "DRAFT"),
});

export type ContentImportRow = z.infer<typeof contentImportRowSchema>;
