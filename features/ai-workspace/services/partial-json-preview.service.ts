/**
 * Phase 22 Stage 3 — safely extracts whatever top-level fields (and, for
 * array-typed fields, whatever elements) are ALREADY fully, verifiably
 * complete in a growing, not-yet-valid JSON string — the raw text a
 * streaming AI response accumulates chunk by chunk. Never guesses, never
 * repairs truncated JSON: a value is reported only once its own closing
 * token has actually appeared in the text; a value cut off mid-string,
 * mid-key, mid-number, or mid-structure is simply not reported yet.
 *
 * Purely cosmetic, schema-agnostic (nothing here knows about "title" or
 * "sections" specifically — that's the caller's job), side-effect-free,
 * and stateless — safe to call fresh on the full accumulated text on every
 * chunk. Never throws: any unexpected shape stops the scan early and
 * returns whatever was already found, since this is a live preview, never
 * a source of truth for anything persisted.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function skipWhitespace(text: string, index: number): number {
  let i = index;
  while (i < text.length && /\s/.test(text[i])) i++;
  return i;
}

/**
 * Finds the end of a JSON string literal starting at text[index] === '"'.
 * Returns the index one past the closing quote, or null if the string
 * never closes within the available text (still being written).
 */
function findStringEnd(text: string, index: number): number | null {
  let i = index + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      i += 2; // Skip the escaped character. Correct even for \uXXXX: skipping just the "\u" pair
      continue; // still leaves the 4 hex digits to walk over as ordinary, non-quote/non-backslash characters.
    }
    if (ch === '"') return i + 1;
    i++;
  }
  return null;
}

/**
 * Finds the end of a bracketed value ({...} or [...]) starting at
 * text[index], correctly skipping over nested strings so a brace/bracket
 * character inside a string literal is never mistaken for real structure.
 * Returns the index one past the matching closer, or null if it never
 * closes within the available text.
 */
function findBracketEnd(text: string, index: number, open: string, close: string): number | null {
  let depth = 0;
  let i = index;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      const stringEnd = findStringEnd(text, i);
      if (stringEnd === null) return null; // an open string inside the structure never closed
      i = stringEnd;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return null;
}

/**
 * Finds the end of a bare primitive token (number/true/false/null) — only
 * "complete" once an unambiguous terminator (,/}/]/whitespace) is seen.
 * Reaching end-of-text mid-token is treated as incomplete, since more
 * characters could still be coming (e.g. "12" growing into "123").
 */
function findPrimitiveEnd(text: string, index: number): number | null {
  let i = index;
  while (i < text.length && !/[,}\]\s]/.test(text[i])) i++;
  if (i >= text.length) return null;
  return i;
}

/**
 * The core generic primitive: given `text` and the index of the first
 * character of a JSON value, returns that value (parsed via the native
 * JSON.parse once its exact boundary is found) plus the index just past
 * it — or null if the value isn't verifiably complete yet. Works for any
 * JSON value at any depth; this is what keeps the scanner schema-agnostic.
 */
function scanValue(text: string, index: number): { value: JsonValue; endIndex: number } | null {
  const start = skipWhitespace(text, index);
  if (start >= text.length) return null;

  const ch = text[start];
  let end: number | null;
  if (ch === '"') end = findStringEnd(text, start);
  else if (ch === "{") end = findBracketEnd(text, start, "{", "}");
  else if (ch === "[") end = findBracketEnd(text, start, "[", "]");
  else end = findPrimitiveEnd(text, start);

  if (end === null) return null;

  const slice = text.slice(start, end);
  try {
    return { value: JSON.parse(slice) as JsonValue, endIndex: end };
  } catch {
    return null; // shouldn't happen given correct boundary-finding, but never trust blindly
  }
}

/**
 * Given the index right after a top-level array's opening `[`, returns
 * whatever elements are already fully complete, plus the index just past
 * the array's closing `]` if it has actually closed (or null if it's still
 * growing) — this is what lets `sections`/`faq`-style arrays reveal one
 * entry at a time instead of only appearing once the whole array is done,
 * while still letting the scan continue past the array once it truly ends.
 */
function scanArraySoFar(text: string, afterOpenBracket: number): { elements: JsonValue[]; endIndex: number | null } {
  const elements: JsonValue[] = [];
  let i = afterOpenBracket;
  while (true) {
    i = skipWhitespace(text, i);
    if (i >= text.length) return { elements, endIndex: null };
    if (text[i] === "]") return { elements, endIndex: i + 1 };

    const scanned = scanValue(text, i);
    if (!scanned) return { elements, endIndex: null }; // next element isn't complete yet — the array's growing edge
    elements.push(scanned.value);

    i = skipWhitespace(text, scanned.endIndex);
    if (i < text.length && text[i] === ",") {
      i++;
      continue;
    }
    if (i < text.length && text[i] === "]") return { elements, endIndex: i + 1 };
    return { elements, endIndex: null }; // ambiguous — treat as still growing rather than guess
  }
}

/**
 * The entry point. Walks the top-level object's "key": value pairs in
 * order; a scalar/object value is included only once fully complete; an
 * array value is included with however many elements are already
 * complete (see scanArraySoFar), even while the array itself is still
 * open. If an array is still open, that's the current growing edge and
 * the scan stops there (nothing after an unfinished array has been
 * written yet, in JSON key order); if the array *has* closed, scanning
 * continues normally to whatever key follows it.
 */
export function parsePreviewFields(text: string): Record<string, JsonValue> {
  const fields: Record<string, JsonValue> = {};
  try {
    const openBraceIndex = text.indexOf("{");
    if (openBraceIndex === -1) return fields;

    let i = skipWhitespace(text, openBraceIndex + 1);
    while (i < text.length) {
      if (text[i] === "}") break;
      if (text[i] !== '"') break; // expected a key here — anything else means we've hit the growing edge

      const keyEnd = findStringEnd(text, i);
      if (keyEnd === null) break; // the key itself is still being written

      const key = JSON.parse(text.slice(i, keyEnd)) as string;

      let j = skipWhitespace(text, keyEnd);
      if (j >= text.length || text[j] !== ":") break;
      j = skipWhitespace(text, j + 1);
      if (j >= text.length) break;

      if (text[j] === "[") {
        const { elements, endIndex } = scanArraySoFar(text, j + 1);
        fields[key] = elements;
        if (endIndex === null) break; // array still growing — this is the edge, stop here
        i = skipWhitespace(text, endIndex);
        if (i < text.length && text[i] === ",") {
          i = skipWhitespace(text, i + 1);
          continue;
        }
        break;
      }

      const scanned = scanValue(text, j);
      if (!scanned) break; // this field's value isn't complete yet — stop here
      fields[key] = scanned.value;

      i = skipWhitespace(text, scanned.endIndex);
      if (i < text.length && text[i] === ",") {
        i = skipWhitespace(text, i + 1);
        continue;
      }
      break;
    }
  } catch {
    // Defensive only — the helpers above are designed to never throw, but a
    // bug here must never crash the review screen. Cosmetic preview only.
  }
  return fields;
}
