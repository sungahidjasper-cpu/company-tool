"use client";

import { useMemo } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { computeWordCount } from "@/features/ai-workspace/services/seo-checklist.service";

const textareaClassName =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

export type LongFormEditableFields = {
  title: string;
  metaTitle: string;
  metaDescription: string;
  body: string;
};

/** Auxiliary draft-generation outputs (Phase 21 §13) — reference-only, never persisted, same treatment as internalLinkPlacementSuggestions below. */
export type LongFormDraftExtras = {
  imagePlaceholders: string[];
  altTextSuggestions: string[];
  featuredImagePrompt?: string;
  socialSnippets: string[];
  excerpt?: string;
};

type LongFormContentReviewProps = {
  fields: LongFormEditableFields;
  onChange: (fields: LongFormEditableFields) => void;
  /** Reviewer-only context, never saved into Content.body — see formatLongFormContentAsMarkdown. */
  internalLinkPlacementSuggestions: string[];
  draftExtras?: LongFormDraftExtras;
  /** The word-count target this article was generated for (Phase 21 §4) — purely informational, never a regenerate-until-in-range gate. */
  targetWordCount?: number;
  onRegenerate: () => void;
  onSave: () => void;
  /** Only present in the fresh flow (brief still in memory) — discards the article and returns to brief review. Omitted in the already-saved-brief flow, which has no brief step to go back to here. */
  onBackToBrief?: () => void;
  isRegenerating: boolean;
  isSaving: boolean;
  error?: string | null;
};

/**
 * Purely presentational + edits-in-place — nothing here writes to the
 * database. The body is a single Markdown textarea (not a section-by-
 * section editor) so the pre-save review experience matches exactly what
 * the post-save Content edit form already offers — one plain-text field,
 * no new editor dependency, no divergent editing model between the two
 * places a user can touch this content.
 */
export default function LongFormContentReview({
  fields,
  onChange,
  internalLinkPlacementSuggestions,
  draftExtras,
  targetWordCount,
  onRegenerate,
  onSave,
  onBackToBrief,
  isRegenerating,
  isSaving,
  error,
}: LongFormContentReviewProps) {
  const busy = isRegenerating || isSaving;
  const actualWordCount = useMemo(() => computeWordCount(fields.body), [fields.body]);

  async function copyAsMarkdown() {
    await navigator.clipboard.writeText(fields.body);
    toast.success("Copied article as Markdown");
  }

  return (
    <div className="flex flex-col gap-4">
      {targetWordCount && (
        <p className="text-sm text-slate-500">
          Word count: {actualWordCount} (target: ~{targetWordCount} — informational only, not enforced)
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="longform-title" className="text-sm font-medium">
          Title
        </label>
        <Input id="longform-title" value={fields.title} onChange={(e) => onChange({ ...fields, title: e.target.value })} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="longform-meta-title" className="text-sm font-medium">
          Meta title
        </label>
        <Input
          id="longform-meta-title"
          value={fields.metaTitle}
          onChange={(e) => onChange({ ...fields, metaTitle: e.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="longform-meta-description" className="text-sm font-medium">
          Meta description
        </label>
        <textarea
          id="longform-meta-description"
          rows={2}
          className={textareaClassName}
          value={fields.metaDescription}
          onChange={(e) => onChange({ ...fields, metaDescription: e.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="longform-body" className="text-sm font-medium">
          Article body (Markdown)
        </label>
        <textarea
          id="longform-body"
          rows={20}
          className={textareaClassName}
          value={fields.body}
          onChange={(e) => onChange({ ...fields, body: e.target.value })}
        />
      </div>

      {internalLinkPlacementSuggestions.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-sm font-medium text-slate-700">Internal-link placement suggestions (for your reference — not saved into the article)</p>
          <ul className="list-inside list-disc text-sm text-slate-600">
            {internalLinkPlacementSuggestions.map((suggestion, index) => (
              <li key={index}>{suggestion}</li>
            ))}
          </ul>
        </div>
      )}

      {draftExtras && (
        <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-sm font-medium text-slate-700">Additional draft outputs (for your reference — not saved into the article)</p>
          {draftExtras.excerpt && (
            <p className="text-sm text-slate-600">
              <span className="font-medium">Excerpt:</span> {draftExtras.excerpt}
            </p>
          )}
          {draftExtras.featuredImagePrompt && (
            <p className="text-sm text-slate-600">
              <span className="font-medium">Featured image prompt:</span> {draftExtras.featuredImagePrompt}
            </p>
          )}
          {draftExtras.imagePlaceholders.length > 0 && (
            <div>
              <p className="text-sm font-medium text-slate-700">Image placeholders</p>
              <ul className="list-inside list-disc text-sm text-slate-600">
                {draftExtras.imagePlaceholders.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {draftExtras.altTextSuggestions.length > 0 && (
            <div>
              <p className="text-sm font-medium text-slate-700">Alt text suggestions</p>
              <ul className="list-inside list-disc text-sm text-slate-600">
                {draftExtras.altTextSuggestions.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {draftExtras.socialSnippets.length > 0 && (
            <div>
              <p className="text-sm font-medium text-slate-700">Social snippets</p>
              <ul className="list-inside list-disc text-sm text-slate-600">
                {draftExtras.socialSnippets.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap gap-3">
        {onBackToBrief && (
          <Button type="button" variant="ghost" onClick={onBackToBrief} disabled={busy}>
            ← Back to brief
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onRegenerate} disabled={busy}>
          {isRegenerating ? "Regenerating..." : "Regenerate"}
        </Button>
        <Button type="button" onClick={onSave} disabled={busy}>
          {isSaving ? "Saving..." : "Save as Draft"}
        </Button>
        <Button type="button" variant="ghost" onClick={copyAsMarkdown} disabled={busy}>
          Copy as Markdown
        </Button>
      </div>
    </div>
  );
}
