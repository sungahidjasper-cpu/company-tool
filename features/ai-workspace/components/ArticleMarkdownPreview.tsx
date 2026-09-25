import type { ReactNode } from "react";

import { isSafeHref, parseMarkdownBlocks, type HeadingLevel, type MarkdownBlock } from "@/features/ai-workspace/services/markdown-preview.service";

/**
 * Builds real DOM elements directly — never an HTML string passed through
 * `dangerouslySetInnerHTML` — since the source text can come from an AI
 * model. React escapes every plain-text child automatically, so the only
 * manual safety check needed is the link href itself (see isSafeHref);
 * everything else has no raw-HTML injection surface at all by construction.
 */
const INLINE_TOKEN = /\*\*(.+?)\*\*|\[(.+?)\]\((.+?)\)|~~(.+?)~~|`(.+?)`|\*(.+?)\*|_(.+?)_/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let index = 0;
  INLINE_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_TOKEN.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const [, bold, linkText, linkHref, struck, inlineCode, italicStar, italicUnderscore] = match;
    if (bold !== undefined) {
      nodes.push(<strong key={`${keyPrefix}-${index++}`}>{bold}</strong>);
    } else if (linkText !== undefined) {
      if (isSafeHref(linkHref)) {
        nodes.push(
          <a key={`${keyPrefix}-${index++}`} href={linkHref} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
            {linkText}
          </a>
        );
      } else {
        // Neutralize rather than render: keep the visible text, drop the unsafe scheme entirely.
        nodes.push(linkText);
      }
    } else if (struck !== undefined) {
      nodes.push(<s key={`${keyPrefix}-${index++}`}>{struck}</s>);
    } else if (inlineCode !== undefined) {
      nodes.push(
        <code key={`${keyPrefix}-${index++}`} className="rounded bg-slate-100 px-1 py-0.5 text-[0.9em]">
          {inlineCode}
        </code>
      );
    } else if (italicStar !== undefined) {
      nodes.push(<em key={`${keyPrefix}-${index++}`}>{italicStar}</em>);
    } else if (italicUnderscore !== undefined) {
      nodes.push(<em key={`${keyPrefix}-${index++}`}>{italicUnderscore}</em>);
    }
    lastIndex = INLINE_TOKEN.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

const HEADING_CLASSES: Record<HeadingLevel, string> = {
  1: "text-2xl font-bold text-slate-900",
  2: "text-xl font-semibold text-slate-900 mt-6",
  3: "text-lg font-medium text-slate-900 mt-4",
  4: "text-base font-medium text-slate-900 mt-3",
  5: "text-sm font-semibold text-slate-900 mt-3",
  6: "text-xs font-semibold tracking-wide text-slate-700 uppercase mt-3",
};

function renderBlock(block: MarkdownBlock, key: number): ReactNode {
  switch (block.type) {
    case "heading": {
      const text = renderInline(block.text, `h-${key}`);
      switch (block.level) {
        case 1:
          return (
            <h1 key={key} className={HEADING_CLASSES[1]}>
              {text}
            </h1>
          );
        case 2:
          return (
            <h2 key={key} className={HEADING_CLASSES[2]}>
              {text}
            </h2>
          );
        case 3:
          return (
            <h3 key={key} className={HEADING_CLASSES[3]}>
              {text}
            </h3>
          );
        case 4:
          return (
            <h4 key={key} className={HEADING_CLASSES[4]}>
              {text}
            </h4>
          );
        case 5:
          return (
            <h5 key={key} className={HEADING_CLASSES[5]}>
              {text}
            </h5>
          );
        case 6:
          return (
            <h6 key={key} className={HEADING_CLASSES[6]}>
              {text}
            </h6>
          );
      }
      break;
    }
    case "paragraph":
      return (
        <p key={key} className="leading-relaxed text-slate-700">
          {block.lines.map((line, i) => (
            <span key={i}>
              {i > 0 && <br />}
              {renderInline(line, `p-${key}-${i}`)}
            </span>
          ))}
        </p>
      );
    case "ul":
      return (
        <ul key={key} className="list-inside list-disc space-y-1 text-slate-700">
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item, `ul-${key}-${i}`)}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol key={key} className="list-inside list-decimal space-y-1 text-slate-700">
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item, `ol-${key}-${i}`)}</li>
          ))}
        </ol>
      );
    case "table":
      return (
        <div key={key} className="overflow-x-auto">
          <table className="w-full border-collapse border border-slate-200 text-sm">
            <thead>
              <tr>
                {block.headers.map((header, i) => (
                  <th key={i} className="border border-slate-200 bg-slate-50 p-2 text-left font-medium text-slate-700">
                    {renderInline(header, `th-${key}-${i}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="border border-slate-200 p-2 text-slate-700">
                      {renderInline(cell, `td-${key}-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    /*
     * Phase 7 — media inside the article.
     *
     * The src is an application path to an existing File record, and it is
     * put through the same href check as a link, so a `javascript:` or
     * `data:` src can never reach an element. An unsafe src renders as the
     * alt text instead, which is the same neutralising choice links make.
     */
    case "image":
      if (!isSafeHref(block.src)) {
        return (
          <p key={key} className="text-sm text-slate-500 italic">
            {block.alt || "Image"}
          </p>
        );
      }
      return (
        <figure key={key} className="flex flex-col gap-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={block.src} alt={block.alt} className="w-full rounded-lg border border-slate-200 object-cover" />
          {block.caption && <figcaption className="text-xs text-slate-500">{block.caption}</figcaption>}
        </figure>
      );
    case "video":
      if (!isSafeHref(block.src)) return null;
      return <video key={key} src={block.src} controls className="w-full rounded-lg border border-slate-200" />;
    case "quote":
      return (
        <blockquote key={key} className="border-l-4 border-slate-300 pl-4 text-slate-600 italic">
          {block.lines.map((line, i) => (
            <span key={i} className="block">
              {renderInline(line, `q-${key}-${i}`)}
            </span>
          ))}
        </blockquote>
      );
    case "code":
      return (
        <pre key={key} className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800">
          <code>{block.lines.join("\n")}</code>
        </pre>
      );
    case "divider":
      return <hr key={key} className="border-slate-200" />;
  }
}

type ArticleMarkdownPreviewProps = {
  title: string;
  /** The same canonical Markdown string the "Edit Source" textarea edits and Save persists — this component only ever reads it, never mutates it. */
  body: string;
};

/**
 * The reader-facing rendered view of the generated article — Markdown stays
 * the sole stored/edited representation (see LongFormContentReview.tsx's
 * "Edit Source" tab); this is a derived, read-only presentation of that same
 * string. Renders dynamically from whatever blocks parseMarkdownBlocks
 * actually finds — no hardcoded section names, no fabricated Key Takeaways/
 * table/etc. when the source doesn't contain one.
 */
export default function ArticleMarkdownPreview({ title, body }: ArticleMarkdownPreviewProps) {
  const blocks = parseMarkdownBlocks(body);
  return (
    <article className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4">
      <h1 className={HEADING_CLASSES[1]}>{title}</h1>
      {blocks.map((block, i) => renderBlock(block, i))}
    </article>
  );
}
