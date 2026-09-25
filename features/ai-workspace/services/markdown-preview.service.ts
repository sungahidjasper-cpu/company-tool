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

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Phase 7 — the block vocabulary the Blog Studio writes and this preview
 * reads. Every one round-trips through Markdown, which stays the canonical
 * storage format on Content.body, so the AI tools, the WordPress publisher
 * and the revision history all keep reading exactly what they read before.
 *
 * `image` and `video` point at an existing File through /api/files/<id>;
 * neither invents a second media store. A video serializes as an ordinary
 * Markdown link, so a plain Markdown reader degrades to a clickable link
 * rather than to broken syntax.
 */
export type MarkdownBlock =
  | { type: "heading"; level: HeadingLevel; text: string }
  | { type: "paragraph"; lines: string[] }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "quote"; lines: string[] }
  | { type: "code"; language: string | null; lines: string[] }
  | { type: "divider" }
  | { type: "image"; src: string; alt: string; caption: string | null }
  | { type: "video"; src: string };

const HEADING = /^(#{1,6})\s+(.*)$/;
/** `![alt](src "caption")` — the caption is Markdown's own title slot, not an invention. */
const IMAGE_LINE = /^!\[([^\]]*)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)$/;
/** A lone `[video](src)` line. An ordinary link to every other Markdown reader. */
const VIDEO_LINE = /^\[video\]\(([^\s)]+)\)$/i;
const QUOTE_LINE = /^>\s?(.*)$/;
const DIVIDER_LINE = /^(?:-{3,}|\*{3,}|_{3,})$/;
const CODE_FENCE = /^```(\w+)?\s*$/;
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
      blocks.push({ type: "heading", level: headingMatch[1].length as HeadingLevel, text: headingMatch[2].trim() });
      i++;
      continue;
    }

    // A fenced code block runs to its closing fence, verbatim.
    const fenceMatch = trimmed.match(CODE_FENCE);
    if (fenceMatch) {
      flushParagraph();
      flushList();
      const language = fenceMatch[1] ?? null;
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        body.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // consume the closing fence
      blocks.push({ type: "code", language, lines: body });
      continue;
    }

    if (DIVIDER_LINE.test(trimmed)) {
      flushParagraph();
      flushList();
      blocks.push({ type: "divider" });
      i++;
      continue;
    }

    const imageMatch = trimmed.match(IMAGE_LINE);
    if (imageMatch) {
      flushParagraph();
      flushList();
      blocks.push({ type: "image", alt: imageMatch[1] ?? "", src: imageMatch[2], caption: imageMatch[3] ? imageMatch[3] : null });
      i++;
      continue;
    }

    const videoMatch = trimmed.match(VIDEO_LINE);
    if (videoMatch) {
      flushParagraph();
      flushList();
      blocks.push({ type: "video", src: videoMatch[1] });
      i++;
      continue;
    }

    if (QUOTE_LINE.test(trimmed)) {
      flushParagraph();
      flushList();
      const quoted: string[] = [];
      while (i < lines.length && QUOTE_LINE.test(lines[i].trim())) {
        quoted.push(lines[i].trim().match(QUOTE_LINE)![1]);
        i++;
      }
      blocks.push({ type: "quote", lines: quoted });
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

/**
 * Phase 7 — blocks back to Markdown.
 *
 * The exact inverse of parseMarkdownBlocks for everything the Blog Studio can
 * produce, so writing in the editor and reopening what was saved give back
 * the same document. Markdown remains the stored format; this is what keeps
 * the editor from needing a format of its own.
 */
const LINE_BREAK = "\n";
const BLOCK_BREAK = "\n\n";

export function serializeMarkdownBlocks(blocks: readonly MarkdownBlock[]): string {
  const parts: string[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case "heading":
        parts.push(`${"#".repeat(block.level)} ${block.text}`);
        break;
      case "paragraph":
        parts.push(block.lines.join(LINE_BREAK));
        break;
      case "ul":
        parts.push(block.items.map((item) => `- ${item}`).join(LINE_BREAK));
        break;
      case "ol":
        parts.push(block.items.map((item, index) => `${index + 1}. ${item}`).join(LINE_BREAK));
        break;
      case "quote":
        parts.push(block.lines.map((line) => `> ${line}`).join(LINE_BREAK));
        break;
      case "code":
        parts.push(["```" + (block.language ?? ""), ...block.lines, "```"].join(LINE_BREAK));
        break;
      case "divider":
        parts.push("---");
        break;
      case "image":
        parts.push(`![${block.alt}](${block.src}${block.caption ? ` "${block.caption.replace(/"/g, "'")}"` : ""})`);
        break;
      case "video":
        parts.push(`[video](${block.src})`);
        break;
      case "table": {
        const header = `| ${block.headers.join(" | ")} |`;
        const divider = `| ${block.headers.map(() => "---").join(" | ")} |`;
        const rows = block.rows.map((row) => `| ${row.join(" | ")} |`);
        parts.push([header, divider, ...rows].join(LINE_BREAK));
        break;
      }
    }
  }

  return parts.filter((part) => part.length > 0).join(BLOCK_BREAK);
}

/** An empty document still needs one place to type. */
export function emptyDocument(): MarkdownBlock[] {
  return [{ type: "paragraph", lines: [""] }];
}
