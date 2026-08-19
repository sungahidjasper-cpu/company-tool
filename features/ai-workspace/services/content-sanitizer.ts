/**
 * Deterministic cleanup for generation-configuration artifacts that a prompt
 * instruction alone cannot guarantee never leak into visible content (e.g.
 * "| 1500 words" appended to a meta title, or "1.1." outline numbering
 * leaking into a heading/FAQ question). Prompt wording measurably reduces
 * how often this happens but cannot mathematically guarantee it against a
 * small/weak fallback model — this pure, regex-based pass is the actual
 * guarantee for this narrow, mechanically-detectable class of defect only.
 * It never touches ordinary prose (only exact trailing/leading patterns),
 * so it carries no risk of stripping real content.
 */

const TRAILING_WORD_COUNT_SUFFIX = /\s*(?:[|\-–—]\s*\d[\d,]*\s*words?\.?|\(\s*\d[\d,]*\s*words?\s*\))\s*$/i;

// Only strips numbering shaped like outline numbering — a multi-level
// "1.1." / "2.3" prefix, or a single top-level number immediately followed
// by "." or ")" (e.g. "1. Introduction", "3) Case Studies"). Deliberately
// does NOT match a bare number followed by a space (e.g. "10 Ways to..."),
// which is ordinary heading content, not a numbering artifact.
const LEADING_OUTLINE_NUMBER = /^\s*(?:\d+(?:\.\d+)+\.?\s+|\d+[.)]\s+)/;

export function stripConfigurationArtifacts(text: string): string {
  let result = text;
  let previous: string;
  do {
    previous = result;
    result = result.replace(TRAILING_WORD_COUNT_SUFFIX, "");
  } while (result !== previous);
  result = result.replace(LEADING_OUTLINE_NUMBER, "");
  return result.trim();
}

// Section headings whose content is already owned by a dedicated output
// field (conclusion/faq/keyTakeaways) and appended separately by
// formatLongFormContentAsMarkdown, plus "resources"-style headings this
// app has no configured section for at all. Matched only after an exact
// normalize (trim, lowercase, drop trailing punctuation) — deliberately
// not a substring/fuzzy match, so a real heading like "Financial Resources
// You'll Need" is never mistaken for one of these and dropped.
const RESERVED_SECTION_HEADINGS = new Set([
  "conclusion",
  "in conclusion",
  "concluding thoughts",
  "final thoughts",
  "faq",
  "faqs",
  "frequently asked questions",
  "key takeaways",
  "takeaways",
  "main takeaways",
  "resources",
  "additional resources",
  "further resources",
  "further reading",
  "references",
  "sources",
  "helpful resources",
]);

function normalizeSectionHeading(heading: string): string {
  return heading.trim().toLowerCase().replace(/[:.!?]+$/, "");
}

/**
 * A weak fallback model sometimes writes its own free-form "Conclusion" /
 * "FAQ" / "Key Takeaways" / "Resources"-style entry inside the open-ended
 * sections[] array, in addition to correctly filling the dedicated
 * conclusion/faq/keyTakeaways fields. Because formatLongFormContentAsMarkdown
 * appends those dedicated fields unconditionally after the sections loop,
 * an unfiltered duplicate renders the same heading twice (or, for
 * "Resources" — a section this app has no toggle for at all — an
 * unrequested section with an unverifiable placeholder link). The
 * dedicated fields are the single source of truth for these regardless of
 * which section toggles are on, so any sections[] entry matching one of
 * these reserved names is dropped entirely, never merged or renamed.
 */
export function filterReservedSections<T extends { heading: string }>(sections: T[]): T[] {
  return sections.filter((section) => !RESERVED_SECTION_HEADINGS.has(normalizeSectionHeading(section.heading)));
}

// Requires a letter immediately after "<" (or "</"), so this only matches
// actually tag-shaped sequences — never a bare comparison like "5 < 10" in
// ordinary prose. A plain-text title/heading/description should never
// legitimately contain markup, so stripping every match carries no risk of
// removing real content.
const HTML_TAG = /<\/?[a-z][a-z0-9]*(?:\s[^<>]*)?>/gi;

export function stripHtmlTags(text: string): string {
  return text.replace(HTML_TAG, "").replace(/\s+/g, " ").trim();
}

// High-confidence signals that a field's entire value is echoed prompt
// instruction text rather than actual content — phrasing a real title or
// meta description would essentially never contain incidentally. Kept
// deliberately small and specific (not a fuzzy/keyword filter) to avoid
// false-positiving on legitimate content.
const INSTRUCTION_ECHO_PATTERNS = [
  /\bmeta\s+(?:title|description)\s*:/i,
  /\bcharacters?\s+total\b/i,
  /\bEXACTLY\s+\d+(?:\s*[\s-]\s*\d+)?\s+(?:characters|words)\b/i,
  /\b\d+\s+words,\s*\d+\s+characters\b/i,
];

/**
 * Detects the class of defect where the model's ENTIRE field value is a
 * fragment of its own instructions (e.g. "EXACTLY 50-60 characters (50
 * words, 60 characters total), meta description:") rather than real
 * content. Unlike stripConfigurationArtifacts, there's no fixed
 * trailing/leading substring to cut — the whole value is unusable — so
 * callers respond by substituting a known-good fallback, never by
 * re-calling the AI or rejecting the generation.
 */
export function looksLikeInstructionEcho(text: string): boolean {
  return INSTRUCTION_ECHO_PATTERNS.some((pattern) => pattern.test(text));
}
