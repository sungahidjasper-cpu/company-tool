import { z } from "zod";

import { optionalNumericString, optionalString, optionalUrl } from "@/lib/zod-helpers";

export const KEYWORD_INTENTS = [
  "INFORMATIONAL",
  "NAVIGATIONAL",
  "COMMERCIAL",
  "TRANSACTIONAL",
] as const;

export const KEYWORD_STATUSES = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "RANKING",
  "ACHIEVED",
  "ABANDONED",
] as const;

export const KEYWORD_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

export const keywordSchema = z.object({
  term: z.string().min(1, "Term is required"),
  clusterId: optionalString(),
  ownerId: optionalString(),
  searchVolume: optionalNumericString(),
  difficulty: optionalNumericString(),
  currentRank: optionalNumericString(),
  targetUrl: optionalUrl(),
  intent: z.enum(KEYWORD_INTENTS).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  priority: z.enum(KEYWORD_PRIORITIES),
  status: z.enum(KEYWORD_STATUSES),
});

export type KeywordInput = z.infer<typeof keywordSchema>;
/** Pre-transform shape (intent still allows "" for the unselected option) — use this for useForm's generic. */
export type KeywordFormInput = z.input<typeof keywordSchema>;

/** One CSV row, before it's validated against keywordSchema at import time. */
export const keywordImportRowSchema = z.object({
  term: z.string().min(1),
  searchVolume: optionalNumericString(),
  difficulty: optionalNumericString(),
  currentRank: optionalNumericString(),
  targetUrl: optionalUrl(),
  cluster: optionalString(),
  intent: z.enum(KEYWORD_INTENTS).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  priority: z.enum(KEYWORD_PRIORITIES).optional().or(z.literal("")).transform((v) => v || "MEDIUM"),
  status: z.enum(KEYWORD_STATUSES).optional().or(z.literal("")).transform((v) => v || "NOT_STARTED"),
});

export type KeywordImportRow = z.infer<typeof keywordImportRowSchema>;
