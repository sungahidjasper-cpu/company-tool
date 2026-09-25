import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SavedBriefSummary } from "@/features/ai-workspace/services/saved-brief-summary";

/**
 * Phase C3 — read-only display of the brief a Content row already carries.
 *
 * Purely presentational: no state, no actions, no writes. Reuses the existing
 * Card vocabulary rather than introducing any new visual system, and renders
 * only the sections the saved brief actually has, so a partially-populated
 * brief never shows empty headings.
 *
 * The brief was previously write-only from the user's point of view — saved,
 * then never shown again outside the long-form generator. Showing it here is
 * what makes returning to a Content record mid-workflow intelligible.
 */
export default function SavedContentBriefCard({ summary }: { summary: SavedBriefSummary }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Content brief</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-slate-500">The saved AI brief this content was created from.</p>

        {summary.suggestedSearchIntent && (
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Search intent</p>
            <p className="text-sm text-slate-700">{summary.suggestedSearchIntent}</p>
          </div>
        )}

        {summary.outline.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Outline</p>
            <ul className="list-inside list-disc text-sm text-slate-700">
              {summary.outline.map((item, index) => (
                <li key={`outline-${index}`}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        {summary.suggestedHeadings.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Suggested headings</p>
            <ul className="list-inside list-disc text-sm text-slate-700">
              {summary.suggestedHeadings.map((item, index) => (
                <li key={`heading-${index}`}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        {summary.seoRecommendations.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">SEO recommendations</p>
            <ul className="list-inside list-disc text-sm text-slate-700">
              {summary.seoRecommendations.map((item, index) => (
                <li key={`seo-${index}`}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        {summary.keyTakeaways.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Key takeaways</p>
            <ul className="list-inside list-disc text-sm text-slate-700">
              {summary.keyTakeaways.map((item, index) => (
                <li key={`takeaway-${index}`}>{item}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
