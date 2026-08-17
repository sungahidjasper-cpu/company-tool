import { parsePartialJson } from "@/lib/ai/streaming/partial-json";

/**
 * Surfaces only the requested top-level SCALAR fields from an in-progress
 * streaming response, and only once each one has actually finished arriving.
 * Deliberately narrow: the caller passes the specific field names worth
 * showing early (e.g. title/metaTitle/metaDescription for a content brief)
 * — arrays and nested objects (outline, faq, sections) are never included
 * here, since they're far more likely to still reflow before the stream
 * finishes. This function does no completeness reasoning of its own;
 * correctness rests entirely on parsePartialJson only ever returning
 * fully-closed values.
 */
export function extractEarlyFields(partialText: string, fieldNames: readonly string[]): Record<string, string> {
  const parsed = parsePartialJson(partialText);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  const record = parsed as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const name of fieldNames) {
    const value = record[name];
    if (typeof value === "string") {
      result[name] = value;
    }
  }
  return result;
}
