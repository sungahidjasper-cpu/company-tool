"use client";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { PressReleaseResult } from "@/features/ai-workspace/schemas/press-release-generator.schema";

/**
 * Plain-text formatting of the structured result for the clipboard — the
 * same role formatLongFormContentAsMarkdown plays for Long-Form Content,
 * but simpler: a press release has no Markdown rendering anywhere in this
 * tool (see PressReleaseReview's own comment on why), so this produces
 * plain, readable text with blank-line separation, not Markdown syntax.
 * Never includes `reasoning` — that field is informational for the
 * reviewer only, never part of the release itself.
 */
export function formatPressReleaseAsText(result: PressReleaseResult): string {
  const parts = [result.headline, result.subheadline, result.dateline, result.leadParagraph, ...result.bodyParagraphs, result.quoteSection, result.boilerplate, result.callToAction];
  return parts.filter((part) => part.trim().length > 0).join("\n\n");
}

type PressReleaseReviewProps = {
  result: PressReleaseResult;
};

/**
 * The dedicated review component — read-only display of the generated
 * press release, plus a copy-to-clipboard action. Purely presentational:
 * no server action, no Content/ContentRevision involvement at all (this
 * tool never touches either model). No Apply control exists and none is
 * planned — matching Schema Markup Generator's own "generate, display, and
 * copy only" precedent exactly (confirmed by inspection: that tool has no
 * apply action anywhere in this codebase).
 *
 * Renders plain text, not through ArticleMarkdownPreview — a press release
 * has no Markdown structure to preserve (no headings/lists the way a
 * Long-Form article or Content Rewriter body does), so introducing that
 * renderer here would add complexity with nothing for it to render.
 */
export default function PressReleaseReview({ result }: PressReleaseReviewProps) {
  async function handleCopy() {
    await navigator.clipboard.writeText(formatPressReleaseAsText(result));
    toast.success("Copied press release to clipboard");
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-slate-800">Press release draft</p>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500">Not saved — copy to use it</span>
      </div>

      <div className="flex flex-col gap-3 text-sm text-slate-800">
        <h2 className="text-lg font-bold text-slate-900">{result.headline}</h2>
        {result.subheadline && <p className="font-medium text-slate-600">{result.subheadline}</p>}
        {result.dateline && <p className="text-xs uppercase tracking-wide text-slate-400">{result.dateline}</p>}
        <p>{result.leadParagraph}</p>
        {result.bodyParagraphs.map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
        {result.quoteSection && <p className="border-l-2 border-slate-200 pl-3 italic text-slate-600">{result.quoteSection}</p>}
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">About</p>
          <p className="text-sm text-slate-600">{result.boilerplate}</p>
        </div>
        {result.callToAction && <p className="font-medium">{result.callToAction}</p>}
      </div>

      <div className="rounded-lg bg-slate-50 p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Notes</p>
        <p className="text-sm text-slate-600">{result.reasoning}</p>
      </div>

      <div className="flex justify-end">
        <Button type="button" size="sm" variant="outline" onClick={handleCopy}>
          Copy press release
        </Button>
      </div>
    </div>
  );
}
