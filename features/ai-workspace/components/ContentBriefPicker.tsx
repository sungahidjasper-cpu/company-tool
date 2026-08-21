"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { getAiGenerationJobAction } from "@/features/ai-workspace/actions/ai-generation-job.actions";
import { previewContentBriefPromptAction, saveContentBriefAction, startContentBriefGenerationAction } from "@/features/ai-workspace/actions/content-brief.actions";
import { saveLongFormAsNewContentAction, startLongFormGenerationAction } from "@/features/ai-workspace/actions/long-form-content.actions";
import ContentBriefReview from "@/features/ai-workspace/components/ContentBriefReview";
import LongFormContentReview, { type LongFormDraftExtras, type LongFormEditableFields } from "@/features/ai-workspace/components/LongFormContentReview";
import {
  BRAND_VOICES,
  CONTENT_BRIEF_SEARCH_INTENTS,
  DEFAULT_CONTENT_BRIEF_SETTINGS,
  FAQ_STYLES,
  READING_LEVELS,
  WORD_COUNT_TARGETS,
  type ContentBriefSettings,
} from "@/features/ai-workspace/schemas/content-brief-settings.schema";
import type { InternalLinkSuggestion } from "@/features/ai-workspace/schemas/content-brief-output-builder";
import { CONTENT_BRIEF_TYPES, contentBriefOutputSchema, type ContentBriefOutput, type ContentBriefType } from "@/features/ai-workspace/schemas/content-brief.schema";
import { formatLongFormContentAsMarkdown, longFormContentOutputSchema } from "@/features/ai-workspace/schemas/long-form-content.schema";
import { parsePreviewFields, type JsonValue } from "@/features/ai-workspace/services/partial-json-preview.service";
import { formatEnumLabel } from "@/lib/utils";

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_MS = 5 * 60 * 1000;

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

const textareaClassName =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

type SeoProjectOption = { id: string; name: string };
type KeywordOption = { id: string; term: string };

type ContentBriefPickerProps = {
  seoProjectOptions: SeoProjectOption[];
  keywordsByProject: Record<string, KeywordOption[]>;
  /** SUPER_ADMIN-only — gates the "Preview AI prompt" button, mirroring Phase 19's CompanyAiLimitsForm visibility pattern. */
  canPreviewPrompt?: boolean;
};

function CheckboxRow({ label, checked, onCheckedChange }: { label: string; checked: boolean; onCheckedChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox checked={checked} onCheckedChange={(value) => onCheckedChange(value === true)} />
      {label}
    </label>
  );
}

function NumberField({ label, value, onChange, min, max }: { label: string; value: number; onChange: (value: number) => void; min: number; max: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium">{label}</label>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || min)))}
      />
    </div>
  );
}

/**
 * Owns the whole generate → review → save state machine client-side.
 * Nothing is written to the database until "Save as Draft" — "Generate"
 * and "Regenerate" both just populate `brief` in memory via
 * generateContentBriefAction, which itself performs no DB write.
 */
export default function ContentBriefPicker({ seoProjectOptions, keywordsByProject, canPreviewPrompt = false }: ContentBriefPickerProps) {
  const router = useRouter();

  const [seoProjectId, setSeoProjectId] = useState(seoProjectOptions[0]?.id ?? "");
  const [keywordId, setKeywordId] = useState("");
  const [contentType, setContentType] = useState<ContentBriefType>("BLOG_POST");
  const [notes, setNotes] = useState("");
  const [settings, setSettings] = useState<ContentBriefSettings>(DEFAULT_CONTENT_BRIEF_SETTINGS);

  const [brief, setBrief] = useState<ContentBriefOutput | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [promptPreview, setPromptPreview] = useState<string | null>(null);
  const [isPreviewingPrompt, setIsPreviewingPrompt] = useState(false);

  // Phase 16 — the long-form step. `longFormFields` non-null means "show
  // LongFormContentReview instead of ContentBriefReview." Nothing here is
  // persisted until handleSaveLongForm; runGenerateLongForm/regenerate
  // never touch the database.
  const [longFormFields, setLongFormFields] = useState<LongFormEditableFields | null>(null);
  const [linkSuggestions, setLinkSuggestions] = useState<InternalLinkSuggestion[]>([]);
  const [draftExtras, setDraftExtras] = useState<LongFormDraftExtras | undefined>(undefined);
  const [isGeneratingLongForm, setIsGeneratingLongForm] = useState(false);
  const [isSavingLongForm, setIsSavingLongForm] = useState(false);

  const keywordOptions = useMemo(() => keywordsByProject[seoProjectId] ?? [], [keywordsByProject, seoProjectId]);
  const targetKeyword = useMemo(() => keywordOptions.find((k) => k.id === keywordId)?.term, [keywordOptions, keywordId]);

  // Phase 22 — a live preview layered on top of the poll loop below, never a
  // replacement for it. streamCharCount/streamProgress are purely cosmetic;
  // isSwitchingProvider briefly shows a wipe-and-restart message when the
  // orchestrator falls back to a different provider mid-stream, so partial
  // output from an abandoned attempt is never confused with the new one.
  const [streamCharCount, setStreamCharCount] = useState<number | null>(null);
  const [streamProgress, setStreamProgress] = useState<number | null>(null);
  const [isSwitchingProvider, setIsSwitchingProvider] = useState(false);
  // Phase 22 Stage 3 — a schema-agnostic scan of the same accumulated text,
  // exposing whichever fields are already fully written. Strictly cosmetic,
  // layered beneath the char-count line above; never a source of truth.
  const [previewFields, setPreviewFields] = useState<Record<string, JsonValue> | null>(null);
  const streamRef = useRef<EventSource | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      streamRef.current?.close();
    };
  }, []);

  /**
   * Phase 22 — best-effort only: if streaming is disabled server-side, this
   * endpoint 404s and onerror below just closes the connection, leaving the
   * existing poll-only experience completely unaffected. Never awaited,
   * never a dependency of anything that detects job completion — that stays
   * pollGenerationJob's job alone.
   */
  function openGenerationStream(jobId: string) {
    streamRef.current?.close();
    setStreamCharCount(null);
    setStreamProgress(null);
    setIsSwitchingProvider(false);
    setPreviewFields(null);

    const source = new EventSource(`/api/ai-workspace/jobs/${jobId}/stream`);
    streamRef.current = source;

    source.addEventListener("text", (event) => {
      try {
        const { text } = JSON.parse((event as MessageEvent).data);
        setIsSwitchingProvider(false);
        setStreamCharCount(typeof text === "string" ? text.length : null);
        setPreviewFields(typeof text === "string" ? parsePreviewFields(text) : null);
      } catch {
        // Malformed event — ignore, this is a cosmetic preview only.
      }
    });
    source.addEventListener("progress", (event) => {
      try {
        const { progress } = JSON.parse((event as MessageEvent).data);
        setStreamProgress(typeof progress === "number" ? progress : null);
      } catch {
        // Ignore — cosmetic only.
      }
    });
    source.addEventListener("reset", () => {
      setIsSwitchingProvider(true);
      setStreamCharCount(null);
      setPreviewFields(null);
    });
    source.addEventListener("done", () => {
      source.close();
    });
    source.onerror = () => {
      source.close();
    };
  }

  function closeGenerationStream() {
    streamRef.current?.close();
    streamRef.current = null;
    setStreamCharCount(null);
    setStreamProgress(null);
    setIsSwitchingProvider(false);
    setPreviewFields(null);
  }

  /**
   * Phase 18 — polls an AiGenerationJob until it settles, then hands the
   * parsed resultJson to onSucceeded. A max poll duration (well above the
   * documented worst case with Phase 17 retries) stops an abandoned/stuck
   * poll from running forever rather than leaving it open-ended.
   */
  function pollGenerationJob(jobId: string, onSucceeded: (resultJson: unknown) => void, onSettled: () => void) {
    if (pollRef.current) clearInterval(pollRef.current);
    const startedAt = Date.now();

    pollRef.current = setInterval(async () => {
      if (Date.now() - startedAt > MAX_POLL_MS) {
        if (pollRef.current) clearInterval(pollRef.current);
        onSettled();
        setError("This is taking longer than expected. Please check back shortly or try again.");
        return;
      }

      const poll = await getAiGenerationJobAction(jobId);
      if (!poll.success) {
        if (pollRef.current) clearInterval(pollRef.current);
        onSettled();
        setError(poll.message);
        return;
      }
      if (!poll.data) return;

      if (poll.data.status === "FAILED") {
        if (pollRef.current) clearInterval(pollRef.current);
        onSettled();
        setError(poll.data.errorMessage ?? "Generation failed.");
        return;
      }

      if (poll.data.status === "SUCCEEDED") {
        if (pollRef.current) clearInterval(pollRef.current);
        onSettled();
        onSucceeded(poll.data.resultJson);
      }
    }, POLL_INTERVAL_MS);
  }

  async function runGenerate() {
    setError(null);
    setIsGenerating(true);
    const result = await startContentBriefGenerationAction({
      seoProjectId,
      keywordId: keywordId || undefined,
      contentType,
      notes: notes || undefined,
      settings,
    });

    if (!result.success) {
      setIsGenerating(false);
      setError(result.message);
      return;
    }

    openGenerationStream(result.data.jobId);
    pollGenerationJob(
      result.data.jobId,
      (resultJson) => {
        const parsed = contentBriefOutputSchema.safeParse(resultJson);
        if (!parsed.success) {
          setError("Received an unexpected result — please try regenerating.");
          return;
        }
        setBrief(parsed.data);
      },
      () => {
        setIsGenerating(false);
        closeGenerationStream();
      }
    );
  }

  async function handlePreviewPrompt() {
    setError(null);
    setIsPreviewingPrompt(true);
    const result = await previewContentBriefPromptAction({
      seoProjectId,
      keywordId: keywordId || undefined,
      contentType,
      notes: notes || undefined,
      settings,
    });
    setIsPreviewingPrompt(false);
    if (!result.success) {
      setError(result.message);
      return;
    }
    setPromptPreview(result.data.prompt);
  }

  async function handleSave() {
    if (!brief) return;
    setError(null);
    setIsSaving(true);
    const result = await saveContentBriefAction({
      seoProjectId,
      keywordId: keywordId || undefined,
      brief,
      settings,
    });
    setIsSaving(false);

    if (!result.success) {
      setError(result.message);
      return;
    }
    toast.success("Draft saved");
    router.push(`/seo/${seoProjectId}/content/${result.data.id}`);
  }

  async function runGenerateLongForm() {
    if (!brief) return;
    setError(null);
    setIsGeneratingLongForm(true);
    const result = await startLongFormGenerationAction({
      mode: "fromBrief",
      seoProjectId,
      keywordId: keywordId || undefined,
      brief,
      settings,
    });

    if (!result.success) {
      setIsGeneratingLongForm(false);
      setError(result.message);
      return;
    }

    openGenerationStream(result.data.jobId);
    pollGenerationJob(
      result.data.jobId,
      (resultJson) => {
        const parsed = longFormContentOutputSchema.safeParse(resultJson);
        if (!parsed.success) {
          setError("Received an unexpected result — please try regenerating.");
          return;
        }
        setLinkSuggestions(parsed.data.internalLinkPlacementSuggestions);
        setDraftExtras({
          imagePlaceholders: parsed.data.imagePlaceholders,
          altTextSuggestions: parsed.data.altTextSuggestions,
          featuredImagePrompt: parsed.data.featuredImagePrompt,
          socialSnippets: parsed.data.socialSnippets,
          excerpt: parsed.data.excerpt,
        });
        setLongFormFields({
          title: brief.title,
          metaTitle: brief.metaTitle,
          metaDescription: brief.metaDescription,
          body: formatLongFormContentAsMarkdown(parsed.data, settings.sections.cta ? settings.cta : undefined),
        });
      },
      () => {
        setIsGeneratingLongForm(false);
        closeGenerationStream();
      }
    );
  }

  async function handleSaveLongForm() {
    if (!longFormFields || !brief) return;
    setError(null);
    setIsSavingLongForm(true);
    const result = await saveLongFormAsNewContentAction({
      seoProjectId,
      keywordId: keywordId || undefined,
      brief,
      settings,
      ...longFormFields,
    });
    setIsSavingLongForm(false);

    if (!result.success) {
      setError(result.message);
      return;
    }
    toast.success("Draft saved");
    router.push(`/seo/${seoProjectId}/content/${result.data.id}`);
  }

  function backToBrief() {
    setLongFormFields(null);
    setError(null);
  }

  if (longFormFields) {
    return (
      <LongFormContentReview
        fields={longFormFields}
        onChange={setLongFormFields}
        internalLinkPlacementSuggestions={linkSuggestions}
        draftExtras={draftExtras}
        targetWordCount={settings.wordCount}
        onRegenerate={runGenerateLongForm}
        onSave={handleSaveLongForm}
        onBackToBrief={backToBrief}
        isRegenerating={isGeneratingLongForm}
        isSaving={isSavingLongForm}
        error={error}
        streamCharCount={streamCharCount}
        streamProgress={streamProgress}
        isSwitchingProvider={isSwitchingProvider}
        previewFields={previewFields}
      />
    );
  }

  if (brief) {
    return (
      <ContentBriefReview
        brief={brief}
        settings={settings}
        targetKeyword={targetKeyword}
        onChange={setBrief}
        onRegenerate={runGenerate}
        onSave={handleSave}
        onGenerateLongForm={runGenerateLongForm}
        isGeneratingLongForm={isGeneratingLongForm}
        isRegenerating={isGenerating}
        isSaving={isSaving}
        error={error}
        regenerateFieldContext={{ seoProjectId, keywordId: keywordId || undefined, contentType, notes: notes || undefined }}
        streamCharCount={streamCharCount}
        streamProgress={streamProgress}
        isSwitchingProvider={isSwitchingProvider}
        previewFields={previewFields}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="seoProjectId" className="text-sm font-medium">
          SEO Project
        </label>
        <select
          id="seoProjectId"
          className={selectClassName}
          value={seoProjectId}
          onChange={(e) => {
            setSeoProjectId(e.target.value);
            setKeywordId("");
          }}
        >
          {seoProjectOptions.length === 0 && <option value="">No SEO projects yet</option>}
          {seoProjectOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="keywordId" className="text-sm font-medium">
          Target keyword (optional)
        </label>
        <select id="keywordId" className={selectClassName} value={keywordId} onChange={(e) => setKeywordId(e.target.value)}>
          <option value="">No specific keyword — use notes below</option>
          {keywordOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.term}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="contentType" className="text-sm font-medium">
          Content type
        </label>
        <select
          id="contentType"
          className={selectClassName}
          value={contentType}
          onChange={(e) => setContentType(e.target.value as ContentBriefType)}
        >
          {CONTENT_BRIEF_TYPES.map((type) => (
            <option key={type} value={type}>
              {formatEnumLabel(type)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="notes" className="text-sm font-medium">
          Additional context/notes (optional)
        </label>
        <textarea
          id="notes"
          rows={3}
          className={textareaClassName}
          placeholder="e.g. target audience, angle to take, things to avoid mentioning"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <details className="rounded-lg border border-slate-200">
        <summary className="cursor-pointer select-none p-3 text-sm font-medium text-slate-700">Content settings</summary>
        <div className="flex flex-col gap-3 border-t border-slate-200 p-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Secondary keywords (comma-separated)</label>
            <Input
              value={settings.secondaryKeywords.join(", ")}
              onChange={(e) => setSettings({ ...settings, secondaryKeywords: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Search intent override</label>
            <select
              className={selectClassName}
              value={settings.searchIntent ?? ""}
              onChange={(e) => setSettings({ ...settings, searchIntent: (e.target.value || undefined) as ContentBriefSettings["searchIntent"] })}
            >
              <option value="">Let the AI decide</option>
              {CONTENT_BRIEF_SEARCH_INTENTS.map((intent) => (
                <option key={intent} value={intent}>
                  {formatEnumLabel(intent)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Target country</label>
              <Input value={settings.targetCountry ?? ""} onChange={(e) => setSettings({ ...settings, targetCountry: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Language</label>
              <Input value={settings.language ?? ""} onChange={(e) => setSettings({ ...settings, language: e.target.value })} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Brand name</label>
            <Input value={settings.brandName ?? ""} onChange={(e) => setSettings({ ...settings, brandName: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Existing URL to optimize (optional)</label>
            <Input
              placeholder="Leave blank to write brand-new content"
              value={settings.existingUrl ?? ""}
              onChange={(e) => setSettings({ ...settings, existingUrl: e.target.value })}
            />
          </div>
        </div>
      </details>

      <details className="rounded-lg border border-slate-200">
        <summary className="cursor-pointer select-none p-3 text-sm font-medium text-slate-700">Article structure</summary>
        <div className="flex flex-col gap-3 border-t border-slate-200 p-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Target word count</label>
            <select
              className={selectClassName}
              value={settings.wordCount}
              onChange={(e) => setSettings({ ...settings, wordCount: Number(e.target.value) as ContentBriefSettings["wordCount"] })}
            >
              {WORD_COUNT_TARGETS.map((count) => (
                <option key={count} value={count}>
                  ~{count} words
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Reading level</label>
              <select
                className={selectClassName}
                value={settings.readingLevel}
                onChange={(e) => setSettings({ ...settings, readingLevel: e.target.value as ContentBriefSettings["readingLevel"] })}
              >
                {READING_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {formatEnumLabel(level)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Brand voice</label>
              <select
                className={selectClassName}
                value={settings.brandVoice}
                onChange={(e) => setSettings({ ...settings, brandVoice: e.target.value as ContentBriefSettings["brandVoice"] })}
              >
                {BRAND_VOICES.map((voice) => (
                  <option key={voice} value={voice}>
                    {formatEnumLabel(voice)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="H2 sections" min={2} max={12} value={settings.outline.h2Count} onChange={(v) => setSettings({ ...settings, outline: { ...settings.outline, h2Count: v } })} />
            <NumberField label="H3 subsections" min={0} max={24} value={settings.outline.h3Count} onChange={(v) => setSettings({ ...settings, outline: { ...settings.outline, h3Count: v } })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <CheckboxRow label="Include comparison table" checked={settings.outline.includeComparisonTable} onCheckedChange={(v) => setSettings({ ...settings, outline: { ...settings.outline, includeComparisonTable: v } })} />
            <CheckboxRow label="Include checklist" checked={settings.outline.includeChecklist} onCheckedChange={(v) => setSettings({ ...settings, outline: { ...settings.outline, includeChecklist: v } })} />
            <CheckboxRow label="Include numbered process" checked={settings.outline.includeNumberedProcess} onCheckedChange={(v) => setSettings({ ...settings, outline: { ...settings.outline, includeNumberedProcess: v } })} />
            <CheckboxRow label="Include pros/cons" checked={settings.outline.includeProsCons} onCheckedChange={(v) => setSettings({ ...settings, outline: { ...settings.outline, includeProsCons: v } })} />
          </div>
        </div>
      </details>

      <details className="rounded-lg border border-slate-200">
        <summary className="cursor-pointer select-none p-3 text-sm font-medium text-slate-700">Sections to include</summary>
        <div className="grid grid-cols-2 gap-2 border-t border-slate-200 p-3">
          <CheckboxRow label="FAQ" checked={settings.sections.faq} onCheckedChange={(v) => setSettings({ ...settings, sections: { ...settings.sections, faq: v } })} />
          <CheckboxRow label="Conclusion" checked={settings.sections.conclusion} onCheckedChange={(v) => setSettings({ ...settings, sections: { ...settings.sections, conclusion: v } })} />
          <CheckboxRow label="Call-to-action" checked={settings.sections.cta} onCheckedChange={(v) => setSettings({ ...settings, sections: { ...settings.sections, cta: v } })} />
          <CheckboxRow label="Key takeaways" checked={settings.sections.keyTakeaways} onCheckedChange={(v) => setSettings({ ...settings, sections: { ...settings.sections, keyTakeaways: v } })} />
          <CheckboxRow label="Internal-link suggestions" checked={settings.sections.internalLinks} onCheckedChange={(v) => setSettings({ ...settings, sections: { ...settings.sections, internalLinks: v } })} />
          <CheckboxRow label="External-source suggestions" checked={settings.sections.externalSources} onCheckedChange={(v) => setSettings({ ...settings, sections: { ...settings.sections, externalSources: v } })} />
          <CheckboxRow label="Schema.org suggestions" checked={settings.sections.schemaSuggestions} onCheckedChange={(v) => setSettings({ ...settings, sections: { ...settings.sections, schemaSuggestions: v } })} />
          <CheckboxRow label="Statistic angles" checked={settings.sections.statistics} onCheckedChange={(v) => setSettings({ ...settings, sections: { ...settings.sections, statistics: v } })} />
          <CheckboxRow label="Example ideas" checked={settings.sections.examples} onCheckedChange={(v) => setSettings({ ...settings, sections: { ...settings.sections, examples: v } })} />
        </div>

        {settings.sections.faq && (
          <div className="grid grid-cols-2 gap-3 border-t border-slate-200 p-3">
            <NumberField label="FAQ count" min={1} max={15} value={settings.faqConfig.count} onChange={(v) => setSettings({ ...settings, faqConfig: { ...settings.faqConfig, count: v } })} />
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">FAQ style</label>
              <select
                className={selectClassName}
                value={settings.faqConfig.style}
                onChange={(e) => setSettings({ ...settings, faqConfig: { ...settings.faqConfig, style: e.target.value as ContentBriefSettings["faqConfig"]["style"] } })}
              >
                {FAQ_STYLES.map((style) => (
                  <option key={style} value={style}>
                    {formatEnumLabel(style)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {settings.sections.cta && (
          <div className="flex flex-col gap-3 border-t border-slate-200 p-3">
            <p className="text-xs text-slate-500">
              These fields are your own literal text — the AI never writes CTA copy. They are inserted exactly as you type them when the article is generated.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Input placeholder="CTA title" value={settings.cta.title ?? ""} onChange={(e) => setSettings({ ...settings, cta: { ...settings.cta, title: e.target.value } })} />
              <Input placeholder="Button text" value={settings.cta.buttonText ?? ""} onChange={(e) => setSettings({ ...settings, cta: { ...settings.cta, buttonText: e.target.value } })} />
            </div>
            <textarea
              className={textareaClassName}
              rows={2}
              placeholder="CTA text"
              value={settings.cta.text ?? ""}
              onChange={(e) => setSettings({ ...settings, cta: { ...settings.cta, text: e.target.value } })}
            />
            <div className="grid grid-cols-3 gap-3">
              <Input placeholder="URL" value={settings.cta.url ?? ""} onChange={(e) => setSettings({ ...settings, cta: { ...settings.cta, url: e.target.value } })} />
              <Input placeholder="Phone" value={settings.cta.phone ?? ""} onChange={(e) => setSettings({ ...settings, cta: { ...settings.cta, phone: e.target.value } })} />
              <Input placeholder="Email" value={settings.cta.email ?? ""} onChange={(e) => setSettings({ ...settings, cta: { ...settings.cta, email: e.target.value } })} />
            </div>
          </div>
        )}
      </details>

      <details className="rounded-lg border border-slate-200">
        <summary className="cursor-pointer select-none p-3 text-sm font-medium text-slate-700">Content quality controls</summary>
        <div className="grid grid-cols-2 gap-2 border-t border-slate-200 p-3">
          {(Object.keys(settings.qualityControls) as (keyof ContentBriefSettings["qualityControls"])[]).map((key) => (
            <CheckboxRow
              key={key}
              label={formatEnumLabel(key.replace(/([A-Z])/g, "_$1").toUpperCase())}
              checked={settings.qualityControls[key]}
              onCheckedChange={(v) => setSettings({ ...settings, qualityControls: { ...settings.qualityControls, [key]: v } })}
            />
          ))}
        </div>
      </details>

      <details className="rounded-lg border border-slate-200">
        <summary className="cursor-pointer select-none p-3 text-sm font-medium text-slate-700">Draft (long-form) output options</summary>
        <div className="grid grid-cols-2 gap-2 border-t border-slate-200 p-3">
          <CheckboxRow label="Image placeholders" checked={settings.draftOptions.imagePlaceholders} onCheckedChange={(v) => setSettings({ ...settings, draftOptions: { ...settings.draftOptions, imagePlaceholders: v } })} />
          <CheckboxRow label="Alt text suggestions" checked={settings.draftOptions.altTextSuggestions} onCheckedChange={(v) => setSettings({ ...settings, draftOptions: { ...settings.draftOptions, altTextSuggestions: v } })} />
          <CheckboxRow label="Featured image prompt" checked={settings.draftOptions.featuredImagePrompt} onCheckedChange={(v) => setSettings({ ...settings, draftOptions: { ...settings.draftOptions, featuredImagePrompt: v } })} />
          <CheckboxRow label="Social snippets" checked={settings.draftOptions.socialSnippets} onCheckedChange={(v) => setSettings({ ...settings, draftOptions: { ...settings.draftOptions, socialSnippets: v } })} />
          <CheckboxRow label="Excerpt" checked={settings.draftOptions.excerpt} onCheckedChange={(v) => setSettings({ ...settings, draftOptions: { ...settings.draftOptions, excerpt: v } })} />
        </div>
      </details>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {isGenerating && (isSwitchingProvider || streamCharCount !== null) && (
        <p className="text-sm text-slate-500">
          {isSwitchingProvider
            ? "Switching to backup AI provider — restarting…"
            : `Generating… ${streamCharCount} characters so far${streamProgress !== null ? ` (~${streamProgress}%)` : ""}`}
        </p>
      )}
      {isGenerating && !isSwitchingProvider && previewFields && Object.keys(previewFields).length > 0 && (
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

      <div className="flex gap-3">
        <Button type="button" onClick={runGenerate} disabled={isGenerating || !seoProjectId}>
          {isGenerating ? "Generating..." : "Generate brief"}
        </Button>
        {canPreviewPrompt && (
          <Button type="button" variant="outline" onClick={handlePreviewPrompt} disabled={isPreviewingPrompt || !seoProjectId}>
            {isPreviewingPrompt ? "Loading preview..." : "Preview AI prompt"}
          </Button>
        )}
      </div>

      {promptPreview && (
        <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-700">Prompt preview (not sent — no AI call was made)</p>
            <Button type="button" variant="ghost" size="sm" onClick={() => setPromptPreview(null)}>
              Close
            </Button>
          </div>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs text-slate-600">{promptPreview}</pre>
        </div>
      )}
    </div>
  );
}
