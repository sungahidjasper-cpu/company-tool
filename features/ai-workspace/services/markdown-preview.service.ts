/**
 * Pure parsing for the long-form article's rendered preview — turns the
 * canonical Markdown string (the same one the "Edit Source" textarea edits
 * and Save persists to Content.body) into a plain block-structure the
 * ArticleMarkdownPreview component maps to real <h1>-<h4>/<p>/<ul>/<ol>/
 * <table> elements. Deliberately line-oriented rather than a naive
 * blank-line block splitter: real generated section bodies routinely put a
 * `###`/`####` sub-header directly above its following paragraph with only
 * a single newline (no blank line), and a splitter keyed on blank lines
 * alone would swallow that heading into an ordinary paragraph, leaving the
 * literal "###" text visible to the reader — exactly the raw-Markdown
 * problem this preview exists to fix.
 */

export type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3 | 4; text: string }
  | { type: "paragraph"; lines: string[] }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] };

const HEADING = /^(#{1,4})\s+(.*)$/;
const ORDERED_ITEM = /^\d+\.\s+(.*)$/;
const UNORDERED_ITEM = /^[-*]\s+(.*)$/;

function isTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length > 0 && /^[\s|:-]+$/.test(trimmed) && trimmed.includes("-");
}

function splitTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  return trimmed.split("|").map((cell) => cell.trim());
}

export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.split("\n");
  const blocks: MarkdownBlock[] = [];
  let paragraphBuffer: string[] = [];
  let listBuffer: { type: "ul" | "ol"; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraphBuffer.length > 0) {
      blocks.push({ type: "paragraph", lines: paragraphBuffer });
      paragraphBuffer = [];
    }
  };
  const flushList = () => {
    if (listBuffer) {
      blocks.push(listBuffer);
      listBuffer = null;
    }
  };

  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (trimmed.length === 0) {
      flushParagraph();
      flushList();
      i++;
      continue;
    }

    const headingMatch = trimmed.match(HEADING);
    if (headingMatch) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: headingMatch[1].length as 1 | 2 | 3 | 4, text: headingMatch[2].trim() });
      i++;
      continue;
    }

    if (trimmed.includes("|") && lines[i + 1] !== undefined && isTableSeparatorLine(lines[i + 1])) {
      flushParagraph();
      flushList();
      const headers = splitTableRow(trimmed);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().length > 0 && lines[i].includes("|")) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    const orderedMatch = trimmed.match(ORDERED_ITEM);
    const unorderedMatch = trimmed.match(UNORDERED_ITEM);
    if (orderedMatch || unorderedMatch) {
      flushParagraph();
      const kind = orderedMatch ? "ol" : "ul";
      const itemText = (orderedMatch ?? unorderedMatch)![1];
      if (listBuffer && listBuffer.type === kind) {
        listBuffer.items.push(itemText);
      } else {
        flushList();
        listBuffer = { type: kind, items: [itemText] };
      }
      i++;
      continue;
    }

    flushList();
    paragraphBuffer.push(trimmed);
    i++;
  }

  flushParagraph();
  flushList();
  return blocks;
}

// Only http(s)/mailto are ever rendered as a real, clickable link. A URL with
// no scheme at all (a relative path) is allowed through unchanged — it can't
// carry an executable protocol. Any other scheme (javascript:, data:,
// vbscript:, etc.) is rejected outright; the caller neutralizes it by
// rendering the link's visible text as plain text instead of an anchor.
const SAFE_SCHEME = /^(https?:|mailto:)/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function isSafeHref(url: string): boolean {
  const trimmed = url.trim();
  if (SAFE_SCHEME.test(trimmed)) return true;
  return !HAS_SCHEME.test(trimmed);
}
