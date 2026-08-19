import type { ContentBriefOutput } from "@/features/ai-workspace/schemas/content-brief.schema";
import { isSafeHref } from "@/features/ai-workspace/services/markdown-preview.service";

/**
 * Flattens a brief into Markdown for the "Copy as Markdown" export button —
 * clipboard-only, no server round-trip. Mirrors
 * long-form-content.schema.ts's formatLongFormContentAsMarkdown in spirit:
 * a small, dependency-free formatter rather than a templating library.
 */
export function formatBriefAsMarkdown(brief: ContentBriefOutput): string {
  const parts: string[] = [`# ${brief.title}`, `**Meta title:** ${brief.metaTitle}`, `**Meta description:** ${brief.metaDescription}`];

  if (brief.outline.length > 0) {
    parts.push(`## Outline\n\n${brief.outline.map((item) => `- ${item}`).join("\n")}`);
  }
  if (brief.suggestedHeadings.length > 0) {
    parts.push(`## Suggested headings\n\n${brief.suggestedHeadings.map((item) => `- ${item}`).join("\n")}`);
  }
  if (brief.keyTakeaways.length > 0) {
    parts.push(`## Key takeaways\n\n${brief.keyTakeaways.map((item) => `- ${item}`).join("\n")}`);
  }
  if (brief.faq.length > 0) {
    parts.push(`## FAQ\n\n${brief.faq.map((item) => `**${item.question}**\n\n${item.answer}`).join("\n\n")}`);
  }
  if (brief.conclusion) {
    parts.push(`## Conclusion\n\n${brief.conclusion}`);
  }
  if (brief.internalLinkSuggestions.length > 0) {
    parts.push(
      `## Internal-link suggestions\n\n${brief.internalLinkSuggestions
        .map((link) => `- **${link.anchorText}** → ${link.targetPage || "(page TBD)"} — ${link.reason} (${link.placement}, priority: ${link.priority})`)
        .join("\n")}`
    );
  }
  if (brief.externalSources.length > 0) {
    parts.push(
      `## External-source suggestions\n\n${brief.externalSources.map((source) => `- [${source.type}] ${source.name} — ${source.description}`).join("\n")}`
    );
  }
  if (brief.seoRecommendations.length > 0) {
    parts.push(`## SEO recommendations\n\n${brief.seoRecommendations.map((item) => `- ${item}`).join("\n")}`);
  }
  if (brief.geoAeoNotes) {
    parts.push(`## GEO/AEO notes\n\n${brief.geoAeoNotes}`);
  }
  parts.push(`## Suggested search intent\n\n${brief.suggestedSearchIntent}`);

  return parts.join("\n\n");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Only http(s)/mailto (or a schemeless relative path) ever become a real
 * `<a href>` — a `javascript:`/`data:`/etc. URL is neutralized to its plain
 * visible text instead, since this HTML can originate from AI-generated
 * content. Any surviving `"` in a safe-scheme URL is escaped so it can't
 * break out of the href attribute either.
 */
function inlineMarkdownToHtml(line: string): string {
  return escapeHtml(line)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[(.+?)\]\((.+?)\)/g, (_match, text: string, href: string) =>
      isSafeHref(href) ? `<a href="${href.replace(/"/g, "&quot;")}">${text}</a>` : text
    );
}

/**
 * A small, dependency-free Markdown→HTML converter for the "Copy as HTML"
 * export button — handles exactly the subset of Markdown this app's own
 * formatters ever produce (#/##/### headings, bold, links, "- " lists,
 * blank-line-separated paragraphs), not general CommonMark. Matches this
 * codebase's existing precedent of hand-rolling small formatters instead of
 * pulling in a Markdown library for a narrow, self-controlled input format.
 */
export function markdownToHtml(markdown: string): string {
  const blocks = markdown.split(/\n\n+/);
  const html: string[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").filter((line) => line.trim().length > 0);
    if (lines.length === 0) continue;

    const headingMatch = lines[0].match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch && lines.length === 1) {
      const level = headingMatch[1].length;
      html.push(`<h${level}>${inlineMarkdownToHtml(headingMatch[2])}</h${level}>`);
      continue;
    }

    const isList = lines.every((line) => line.trim().startsWith("- "));
    if (isList) {
      const items = lines.map((line) => `<li>${inlineMarkdownToHtml(line.trim().slice(2))}</li>`).join("");
      html.push(`<ul>${items}</ul>`);
      continue;
    }

    html.push(`<p>${lines.map(inlineMarkdownToHtml).join("<br />")}</p>`);
  }

  return html.join("\n");
}
