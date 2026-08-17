/**
 * Best-effort parse of a possibly-truncated JSON string — the accumulating
 * text of an in-progress streaming AI response. Never guesses a value for a
 * field that hasn't finished arriving: it only ever returns a prefix of the
 * text that is already, on its own, valid JSON once trailing open
 * brackets/braces are closed. Real JSON.parse() is the arbiter of validity
 * for every candidate — this function only computes candidate cut points
 * and the closing suffix each one needs, rather than re-implementing JSON's
 * grammar itself.
 *
 * Algorithm: walk the text once to record, at every index, the open-
 * bracket/brace stack and whether that index falls inside a string literal
 * (so a candidate is never cut mid-string, which would otherwise require
 * guessing whether the string was "done"). Then try candidates from the
 * full length backward — cut the text there, drop a dangling trailing
 * comma, append the closing brackets the stack at that point calls for, and
 * attempt JSON.parse. The first (longest) candidate that parses wins.
 */
export function parsePartialJson(text: string): unknown {
  const length = text.length;
  const stackAtIndex: ("{" | "[")[][] = new Array(length + 1);
  const inStringAtIndex: boolean[] = new Array(length + 1);

  const stack: ("{" | "[")[] = [];
  let inString = false;
  let escapeNext = false;

  stackAtIndex[0] = [];
  inStringAtIndex[0] = false;

  for (let i = 0; i < length; i++) {
    const ch = text[i];
    if (inString) {
      if (escapeNext) {
        escapeNext = false;
      } else if (ch === "\\") {
        escapeNext = true;
      } else if (ch === '"') {
        inString = false;
      }
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "{" || ch === "[") {
      stack.push(ch);
    } else if (ch === "}" || ch === "]") {
      stack.pop();
    }
    stackAtIndex[i + 1] = stack.slice();
    inStringAtIndex[i + 1] = inString;
  }

  for (let i = length; i >= 0; i--) {
    if (inStringAtIndex[i]) continue;

    const candidate = text.slice(0, i).trimEnd().replace(/,\s*$/, "");
    const suffix = stackAtIndex[i]
      .slice()
      .reverse()
      .map((bracket) => (bracket === "{" ? "}" : "]"))
      .join("");

    try {
      return JSON.parse(candidate + suffix);
    } catch {
      continue;
    }
  }

  return undefined;
}
