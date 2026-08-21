"use client";

import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { regenerateBriefFieldAction, type RegenerateBriefField } from "@/features/ai-workspace/actions/content-brief.actions";
import { describeLlmError, type LlmErrorType } from "@/lib/ai/providers/errors";
import { formatBriefAsMarkdown, markdownToHtml } from "@/features/ai-workspace/services/content-export.service";
import { checkMetaLengths, computeSeoChecklist } from "@/features/ai-workspace/services/seo-checklist.service";
import type { ContentBriefSettings } from "@/features/ai-workspace/schemas/content-brief-settings.schema";
import type { ContentBriefOutput, ContentBriefType } from "@/features/ai-workspace/schemas/content-brief.schema";
import type { JsonValue } from "@/features/ai-workspace/services/partial-json-preview.service";

const textareaClassName =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

function linesToArray(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

type RegenerateFieldContext = {
  seoProjectId: string;
  keywordId?: string;
  contentType: ContentBriefType;
  notes?: string;
};

type ContentBriefReviewProps = {
  brief: ContentBriefOutput;
  settings: ContentBriefSettings;
  /** Used for the SEO checklist's keyword-presence checks — omitted when generation was ad-hoc/notes-only. */
  targetKeyword?: string;
  onChange: (brief: ContentBriefOutput) => void;
  onRegenerate: () => void;
  onSave: () => void;
  /**
   * Phase 16 — optional, additive. When provided, renders a third action
   * that moves to the long-form generation step WITHOUT saving the brief
   * (nothing is persisted by this button). Omitting this prop reproduces
   * Phase 15's exact original behavior — "Save as Draft" still saves the
   * brief alone, unchanged.
   */
  onGenerateLongForm?: () => void;
  isGeneratingLongForm?: boolean;
  isRegenerating: boolean;
  isSaving: boolean;
  error?: string | null;
  /**
   * Phase 23 Stage 2 — when the failed job's own `errorType` is known,
   * ContentBriefPicker passes it through so the structured
   * describeLlmError() description (title/message/recommendedAction) can
   * be shown instead of the flat `error` string. `error` is always kept in
   * sync as the fallback for failures that never reach provider-error
   * classification (a client-side timeout, "job not found," etc.).
   */
  errorType?: LlmErrorType | null;
  /** Phase 21 §15 — context regenerateBriefFieldAction needs to rebuild the same prompt for a single-field regeneration. */
  regenerateFieldContext: RegenerateFieldContext;
  /**
   * Phase 23 Stage 1 — the same Phase 22 streaming state ContentBriefPicker
   * already owns, passed through so it stays visible during brief
   * regeneration and long-form generation, not just on the very first
   * brief generation (which never reaches this component). Purely
   * cosmetic, same invariant as Phase 22: never read by onSave/onChange,
   * never affects what gets persisted.
   */
  streamCharCount?: number | null;
  streamProgress?: number | null;
  isSwitchingProvider?: boolean;
  previewFields?: Record<string, JsonValue> | null;
};

function CounterBadge({ length, min, max }: { length: number; min: number; max: number }) {
  const status = length < min ? "TOO_SHORT" : length > max ? "TOO_LONG" : "OK";
  const color = status === "OK" ? "text-emerald-600" : "text-amber-600";
  return (
    <span className={`text-xs ${color}`}>
      {length}/{min}-{max} chars {status === "OK" ? "✅" : "⚠"}
    </span>
  );
}

/** Declared outside the parent's render, not as a nested function component, so state isn't reset on every ContentBriefReview render. */
function RegenerateFieldButton({
  field,
  disabled,
  regeneratingField,
  onRegenerate,
}: {
  field: RegenerateBriefField;
  disabled: boolean;
  regeneratingField: RegenerateBriefField | null;
  onRegenerate: (field: RegenerateBriefField) => void;
}) {
  return (
    <Button type="button" variant="ghost" size="sm" onClick={() => onRegenerate(field)} disabled={disabled}>
      {regeneratingField === field ? "Regenerating..." : "Regenerate this field"}
    </Button>
  );
}

/**
 * Purely presentational + edits-in-place — nothing here writes to the
 * database. "Regenerate" and "Save as Draft" are both just callbacks the
 * parent (ContentBriefPicker) wires to the actual server actions; this
 * component only ever holds the current in-memory candidate. Phase 21
 * makes rendering modular (only enabled sections show) and adds the SEO
 * checklist, character counters, per-field regeneration, and export
 * buttons.
 */
export default function ContentBriefReview({
  brief,
  settings,
  targetKeyword,
  onChange,
  onRegenerate,
  onSave,
  onGenerateLongForm,
  isGeneratingLongForm = false,
  isRegenerating,
  isSaving,
  error,
  errorType = null,
  regenerateFieldContext,
  streamCharCount = null,
  streamProgress = null,
  isSwitchingProvider = false,
  previewFields = null,
}: ContentBriefReviewProps) {
  const busy = isRegenerating || isSaving || isGeneratingLongForm;
  const [regeneratingField, setRegeneratingField] = useState<RegenerateBriefField | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const lengths = useMemo(() => checkMetaLengths(brief), [brief]);
  const checklist = useMemo(() => computeSeoChecklist(brief, settings, targetKeyword), [brief, settings, targetKeyword]);

  async function handleRegenerateField(field: RegenerateBriefField) {
    setFieldError(null);
    setRegeneratingField(field);
    const result = await regenerateBriefFieldAction({ ...regenerateFieldContext, currentBrief: brief, field });
    setRegeneratingField(null);
    if (!result.success) {
      setFieldError(result.message);
      return;
    }
    onChange(result.data);
  }

  async function copyAsMarkdown() {
    await navigator.clipboard.writeText(formatBriefAsMarkdown(brief));
    toast.success("Copied brief as Markdown");
  }

  async function copyAsHtml() {
    await navigator.clipboard.writeText(markdownToHtml(formatBriefAsMarkdown(brief)));
    toast.success("Copied brief as HTML");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="brief-title" className="text-sm font-medium">
            Title
          </label>
          <RegenerateFieldButton field="title" disabled={busy || regeneratingField !== null} regeneratingField={regeneratingField} onRegenerate={handleRegenerateField} />
        </div>
        <Input id="brief-title" value={brief.title} onChange={(e) => onChange({ ...brief, title: e.target.value })} />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="brief-meta-title" className="text-sm font-medium">
            Meta title
          </label>
          <div className="flex items-center gap-2">
            <CounterBadge length={lengths.metaTitle.length} min={lengths.metaTitle.min} max={lengths.metaTitle.max} />
            <RegenerateFieldButton field="metaTitle" disabled={busy || regeneratingField !== null} regeneratingField={regeneratingField} onRegenerate={handleRegenerateField} />
          </div>
        </div>
        <Input
          id="brief-meta-title"
          value={brief.metaTitle}
          onChange={(e) => onChange({ ...brief, metaTitle: e.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="brief-meta-description" className="text-sm font-medium">
            Meta description
          </label>
          <div className="flex items-center gap-2">
            <CounterBadge length={lengths.metaDescription.length} min={lengths.metaDescription.min} max={lengths.metaDescription.max} />
            <RegenerateFieldButton field="metaDescription" disabled={busy || regeneratingField !== null} regeneratingField={regeneratingField} onRegenerate={handleRegenerateField} />
          </div>
        </div>
        <textarea
          id="brief-meta-description"
          rows={2}
          className={textareaClassName}
          value={brief.metaDescription}
          onChange={(e) => onChange({ ...brief, metaDescription: e.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="brief-outline" className="text-sm font-medium">
            Outline (one section per line) — {brief.outline.length} of {settings.outline.h2Count} requested
          </label>
          <RegenerateFieldButton field="outline" disabled={busy || regeneratingField !== null} regeneratingField={regeneratingField} onRegenerate={handleRegenerateField} />
        </div>
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

      {settings.sections.internalLinks && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">Internal-link suggestions</label>
          <div className="flex flex-col gap-2">
            {brief.internalLinkSuggestions.map((link, index) => (
              <div key={index} className="rounded-lg border border-slate-200 p-2 text-sm">
                <p className="font-medium text-slate-700">{link.anchorText || "(no anchor text)"}</p>
                <p className="text-slate-500">
                  → {link.targetPage || "(page TBD)"} · {link.reason} · {link.placement} · priority: {link.priority}
                </p>
              </div>
            ))}
            {brief.internalLinkSuggestions.length === 0 && <p className="text-sm text-slate-400">No suggestions generated.</p>}
          </div>
        </div>
      )}

      {settings.sections.externalSources && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">External-source suggestions (never a fabricated URL — add a verified link yourself before publishing)</label>
          <div className="flex flex-col gap-2">
            {brief.externalSources.map((source, index) => (
              <div key={index} className="rounded-lg border border-slate-200 p-2 text-sm">
                <p className="font-medium text-slate-700">
                  [{source.type}] {source.name}
                </p>
                <p className="text-slate-500">{source.description}</p>
              </div>
            ))}
            {brief.externalSources.length === 0 && <p className="text-sm text-slate-400">No suggestions generated.</p>}
          </div>
        </div>
      )}

      {settings.sections.faq && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">
              FAQ — {brief.faq.length} of {settings.faqConfig.count} requested
            </label>
            <RegenerateFieldButton field="faq" disabled={busy || regeneratingField !== null} regeneratingField={regeneratingField} onRegenerate={handleRegenerateField} />
          </div>
          <div className="flex flex-col gap-2">
            {brief.faq.map((item, index) => (
              <div key={index} className="rounded-lg border border-slate-200 p-2 text-sm">
                <p className="font-medium text-slate-700">{item.question}</p>
                <p className="text-slate-500">{item.answer}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {settings.sections.keyTakeaways && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">Key takeaways</label>
          <ul className="list-inside list-disc text-sm text-slate-600">
            {brief.keyTakeaways.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {settings.sections.conclusion && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">Conclusion (brief note)</label>
          <textarea
            rows={2}
            className={textareaClassName}
            value={brief.conclusion}
            onChange={(e) => onChange({ ...brief, conclusion: e.target.value })}
          />
        </div>
      )}

      {settings.sections.cta && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">CTA placement suggestion (guidance only — your own CTA text is inserted as-is at draft time)</label>
            <RegenerateFieldButton field="cta" disabled={busy || regeneratingField !== null} regeneratingField={regeneratingField} onRegenerate={handleRegenerateField} />
          </div>
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-sm text-slate-600">{brief.ctaPlacementSuggestion || "No suggestion generated."}</p>
        </div>
      )}

      {(settings.sections.schemaSuggestions || settings.sections.statistics || settings.sections.examples) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {settings.sections.schemaSuggestions && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Schema.org suggestions</label>
              <ul className="list-inside list-disc text-sm text-slate-600">
                {brief.schemaSuggestions.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {settings.sections.statistics && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Statistic angles</label>
              <ul className="list-inside list-disc text-sm text-slate-600">
                {brief.statistics.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {settings.sections.examples && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Example ideas</label>
              <ul className="list-inside list-disc text-sm text-slate-600">
                {brief.examples.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

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

      <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-sm font-medium text-slate-700">SEO quality checklist</p>
        <ul className="flex flex-col gap-1">
          {checklist.map((item) => (
            <li key={item.id} className="flex items-center gap-2 text-sm">
              <span>{item.status === "PASS" ? "✅" : "⚠"}</span>
              <span className="text-slate-600">{item.label}</span>
              <span className="text-xs text-slate-400">({item.detail})</span>
            </li>
          ))}
        </ul>
      </div>

      {errorType ? (
        (() => {
          const description = describeLlmError(errorType);
          return (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-destructive" />
              <div className="flex flex-col gap-1">
                <p className="font-medium text-destructive">{description.title}</p>
                <p className="text-sm text-destructive/80">{description.message}</p>
                <p className="text-sm text-destructive/80">{description.recommendedAction}</p>
              </div>
            </div>
          );
        })()
      ) : (
        (error || fieldError) && <p className="text-sm text-destructive">{error || fieldError}</p>
      )}

      {(isRegenerating || isGeneratingLongForm) && (isSwitchingProvider || streamCharCount !== null) && (
        <p className="text-sm text-slate-500">
          {isSwitchingProvider
            ? "Switching to backup AI provider — restarting…"
            : `Generating… ${streamCharCount} characters so far${streamProgress !== null ? ` (~${streamProgress}%)` : ""}`}
        </p>
      )}
      {(isRegenerating || isGeneratingLongForm) && !isSwitchingProvider && streamCharCount !== null && streamProgress !== null && (
        <Progress value={streamProgress} />
      )}
      {isRegenerating && !isSwitchingProvider && previewFields && Object.keys(previewFields).length > 0 && (
        <div className="space-y-1 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
          {typeof previewFields.title === "string" && (
            <p>
              <span className="font-medium text-slate-700">Title:</span> {previewFields.title}
            </p>
          )}
          {typeof previewFields.metaTitle === "string" && (
            <p>
              <span className="font-medium text-slate-700">Meta title:</span> {previewFields.metaTitle}
            </p>
          )}
          {typeof previewFields.metaDescription === "string" && (
            <p>
              <span className="font-medium text-slate-700">Meta description:</span> {previewFields.metaDescription}
            </p>
          )}
          {Array.isArray(previewFields.outline) && previewFields.outline.length > 0 && (
            <p>
              <span className="font-medium text-slate-700">Outline so far ({previewFields.outline.length}):</span>{" "}
              {previewFields.outline.filter((item): item is string => typeof item === "string").join(", ")}
            </p>
          )}
          {Array.isArray(previewFields.faq) && previewFields.faq.length > 0 && (
            <p>
              <span className="font-medium text-slate-700">FAQ items so far:</span> {previewFields.faq.length}
            </p>
          )}
        </div>
      )}
      {isGeneratingLongForm && !isSwitchingProvider && previewFields && Object.keys(previewFields).length > 0 && (
        <div className="space-y-1 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
          {typeof previewFields.introduction === "string" && (
            <p>
              <span className="font-medium text-slate-700">Introduction:</span> {previewFields.introduction}
            </p>
          )}
          {Array.isArray(previewFields.sections) && previewFields.sections.length > 0 && (
            <p>
              <span className="font-medium text-slate-700">Sections so far ({previewFields.sections.length}):</span>{" "}
              {previewFields.sections
                .map((section) => (typeof section === "object" && section && "heading" in section ? section.heading : null))
                .filter((heading): heading is string => typeof heading === "string")
                .join(", ")}
            </p>
          )}
          {typeof previewFields.conclusion === "string" && (
            <p>
              <span className="font-medium text-slate-700">Conclusion:</span> {previewFields.conclusion}
            </p>
          )}
          {Array.isArray(previewFields.faq) && previewFields.faq.length > 0 && (
            <p>
              <span className="font-medium text-slate-700">FAQ items so far:</span> {previewFields.faq.length}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="outline" onClick={onRegenerate} disabled={busy}>
          {isRegenerating ? "Regenerating..." : "Regenerate"}
        </Button>
        <Button type="button" onClick={onSave} disabled={busy}>
          {isSaving ? "Saving..." : "Save as Draft"}
        </Button>
        {onGenerateLongForm && (
          <Button type="button" variant="outline" onClick={onGenerateLongForm} disabled={busy}>
            {isGeneratingLongForm ? "Generating article..." : "Generate Long-Form Content"}
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={copyAsMarkdown} disabled={busy}>
          Copy as Markdown
        </Button>
        <Button type="button" variant="ghost" onClick={copyAsHtml} disabled={busy}>
          Copy as HTML
        </Button>
      </div>
    </div>
  );
}
