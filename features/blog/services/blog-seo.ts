/**
 * Phase 7 — the Blog Studio's SEO panel rules.
 *
 * Pure and read-only. These are the same fields the Meta Tag Optimizer
 * already writes (`Content.metaTitle`, `Content.metaDescription`) and the
 * same URL column Content already has — no second SEO system, and no new
 * column. This module only decides how to guide and how to preview.
 */

/** Widely used display limits. Guidance, not enforcement — a longer title is truncated by search engines, not rejected. */
export const SEO_TITLE_IDEAL = { min: 30, max: 60 } as const;
export const SEO_DESCRIPTION_IDEAL = { min: 120, max: 160 } as const;

export type LengthGuidance = {
  length: number;
  status: "EMPTY" | "SHORT" | "GOOD" | "LONG";
  message: string;
};

export function guideLength(value: string, ideal: { min: number; max: number }, label: string): LengthGuidance {
  const length = value.trim().length;
  if (length === 0) return { length, status: "EMPTY", message: `No ${label} yet.` };
  if (length < ideal.min) return { length, status: "SHORT", message: `${length} characters — aim for ${ideal.min}–${ideal.max}.` };
  if (length > ideal.max) return { length, status: "LONG", message: `${length} characters — over ${ideal.max}, search engines will truncate it.` };
  return { length, status: "GOOD", message: `${length} characters — within the ${ideal.min}–${ideal.max} range.` };
}

/**
 * A URL-safe slug from a title.
 *
 * Offered as a suggestion the user can overwrite; it is never applied on its
 * own, because a published article's URL is not something to change silently
 * underneath whoever is linking to it.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * What the search preview shows.
 *
 * Falls back to the article title and the start of the body only for the
 * PREVIEW — never for what is stored. Search engines do exactly this when a
 * meta field is missing, so showing it is honest; writing it into the record
 * would invent metadata the user never approved.
 */
export type SearchPreview = {
  title: string;
  url: string;
  description: string;
  usingFallbackTitle: boolean;
  usingFallbackDescription: boolean;
};

export function buildSearchPreview(input: {
  metaTitle: string;
  metaDescription: string;
  title: string;
  slug: string;
  bodyExcerpt: string;
  siteDomain: string | null;
}): SearchPreview {
  const metaTitle = input.metaTitle.trim();
  const metaDescription = input.metaDescription.trim();
  const slug = input.slug.trim().replace(/^\/+/, "");
  const domain = (input.siteDomain ?? "example.com").replace(/^https?:\/\//, "").replace(/\/+$/, "");

  return {
    title: metaTitle || input.title.trim() || "Untitled article",
    url: `${domain}/${slug}`,
    description: metaDescription || input.bodyExcerpt.trim() || "No description yet.",
    usingFallbackTitle: metaTitle.length === 0,
    usingFallbackDescription: metaDescription.length === 0,
  };
}

/** The first readable prose from the article, for the preview's fallback description. */
export function bodyExcerpt(markdown: string, maxLength = 180): string {
  const firstProse = markdown
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !/^([#>|`-]|!\[|\d+\.|\[video\])/.test(line));
  if (!firstProse) return "";
  const plain = firstProse.replace(/\*\*(.+?)\*\*/g, "$1").replace(/[*_~`]/g, "").replace(/\[(.+?)\]\(.+?\)/g, "$1");
  return plain.length > maxLength ? `${plain.slice(0, maxLength - 1).trimEnd()}…` : plain;
}
