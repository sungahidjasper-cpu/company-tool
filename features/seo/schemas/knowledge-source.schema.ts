import { z } from "zod";

import { optionalString, optionalUrl } from "@/lib/zod-helpers";

/**
 * Suggested categories, shown to the user as picker options — sourceType
 * itself is a free-text column (not a Prisma enum), so a new category never
 * requires a migration. See prisma/schema.prisma's KnowledgeSource comment.
 */
export const RECOMMENDED_SOURCE_TYPES = [
  "OFFICIAL_DOCUMENTATION",
  "GOVERNMENT_PUBLIC_INSTITUTION",
  "INDUSTRY_ORGANIZATION",
  "SEARCH_ENGINE_DOCUMENTATION",
  "TECHNICAL_DOCUMENTATION",
  "RESEARCH_PUBLICATION",
  "CLIENT_PROVIDED",
  "OTHER",
] as const;

export const knowledgeSourceSchema = z.object({
  title: z.string().min(2, "Title must be at least 2 characters"),
  url: optionalUrl(),
  sourceType: z
    .string()
    .trim()
    .min(1, "Source type is required")
    .max(60, "Source type must be 60 characters or fewer"),
  description: optionalString(),
  content: optionalString(),
  publishedAt: optionalString(),
  lastVerifiedAt: optionalString(),
});

export type KnowledgeSourceInput = z.infer<typeof knowledgeSourceSchema>;

export const knowledgeSourceLinkSchema = z.object({
  knowledgeSourceId: z.string().uuid("Invalid source id"),
  seoProjectId: z.string().uuid("Invalid SEO project id"),
  note: optionalString(),
});

export type KnowledgeSourceLinkInput = z.infer<typeof knowledgeSourceLinkSchema>;
