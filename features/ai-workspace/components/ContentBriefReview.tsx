"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ContentBriefOutput } from "@/features/ai-workspace/schemas/content-brief.schema";

const textareaClassName =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

function linesToArray(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

type ContentBriefReviewProps = {
  brief: ContentBriefOutput;
  onChange: (brief: ContentBriefOutput) => void;
  onRegenerate: () => void;
  onSave: () => void;
  isRegenerating: boolean;
  isSaving: boolean;
  error?: string | null;
};

/**
 * Purely presentational + edits-in-place — nothing here writes to the
 * database. "Regenerate" and "Save as Draft" are both just callbacks the
 * parent (ContentBriefPicker) wires to the actual server actions; this
 * component only ever holds the current in-memory candidate.
 */
export default function ContentBriefReview({
  brief,
  onChange,
  onRegenerate,
  onSave,
  isRegenerating,
  isSaving,
  error,
}: ContentBriefReviewProps) {
  const busy = isRegenerating || isSaving;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="brief-title" className="text-sm font-medium">
          Title
        </label>
        <Input id="brief-title" value={brief.title} onChange={(e) => onChange({ ...brief, title: e.target.value })} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="brief-meta-title" className="text-sm font-medium">
          Meta title
        </label>
        <Input
          id="brief-meta-title"
          value={brief.metaTitle}
          onChange={(e) => onChange({ ...brief, metaTitle: e.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="brief-meta-description" className="text-sm font-medium">
          Meta description
        </label>
        <textarea
          id="brief-meta-description"
          rows={2}
          className={textareaClassName}
          value={brief.metaDescription}
          onChange={(e) => onChange({ ...brief, metaDescription: e.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="brief-outline" className="text-sm font-medium">
          Outline (one section per line)
        </label>
        <textarea
          id="brief-outline"
          rows={5}
          className={textareaClassName}
          value={brief.outline.join("\n")}
          onChange={(e) => onChange({ ...brief, outline: linesToArray(e.target.value) })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="brief-headings" className="text-sm font-medium">
          Suggested headings (one per line)
        </label>
        <textarea
          id="brief-headings"
          rows={4}
          className={textareaClassName}
          value={brief.suggestedHeadings.join("\n")}
          onChange={(e) => onChange({ ...brief, suggestedHeadings: linesToArray(e.target.value) })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="brief-links" className="text-sm font-medium">
          Internal-link suggestions (one per line)
        </label>
        <textarea
          id="brief-links"
          rows={3}
          className={textareaClassName}
          value={brief.internalLinkSuggestions.join("\n")}
          onChange={(e) => onChange({ ...brief, internalLinkSuggestions: linesToArray(e.target.value) })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="brief-seo" className="text-sm font-medium">
          SEO recommendations (one per line)
        </label>
        <textarea
          id="brief-seo"
          rows={3}
          className={textareaClassName}
          value={brief.seoRecommendations.join("\n")}
          onChange={(e) => onChange({ ...brief, seoRecommendations: linesToArray(e.target.value) })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="brief-geo-aeo" className="text-sm font-medium">
          GEO/AEO notes
        </label>
        <textarea
          id="brief-geo-aeo"
          rows={3}
          className={textareaClassName}
          value={brief.geoAeoNotes}
          onChange={(e) => onChange({ ...brief, geoAeoNotes: e.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="brief-intent" className="text-sm font-medium">
          Suggested search intent
        </label>
        <Input
          id="brief-intent"
          value={brief.suggestedSearchIntent}
          onChange={(e) => onChange({ ...brief, suggestedSearchIntent: e.target.value })}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-3">
        <Button type="button" variant="outline" onClick={onRegenerate} disabled={busy}>
          {isRegenerating ? "Regenerating..." : "Regenerate"}
        </Button>
        <Button type="button" onClick={onSave} disabled={busy}>
          {isSaving ? "Saving..." : "Save as Draft"}
        </Button>
      </div>
    </div>
  );
}
