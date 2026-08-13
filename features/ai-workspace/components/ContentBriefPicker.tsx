"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { generateContentBriefAction, saveContentBriefAction } from "@/features/ai-workspace/actions/content-brief.actions";
import { generateLongFormFromBriefAction, saveLongFormAsNewContentAction } from "@/features/ai-workspace/actions/long-form-content.actions";
import ContentBriefReview from "@/features/ai-workspace/components/ContentBriefReview";
import LongFormContentReview, { type LongFormEditableFields } from "@/features/ai-workspace/components/LongFormContentReview";
import { CONTENT_BRIEF_TYPES, type ContentBriefOutput, type ContentBriefType } from "@/features/ai-workspace/schemas/content-brief.schema";
import { formatLongFormContentAsMarkdown } from "@/features/ai-workspace/schemas/long-form-content.schema";
import { formatEnumLabel } from "@/lib/utils";

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

const textareaClassName =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

type SeoProjectOption = { id: string; name: string };
type KeywordOption = { id: string; term: string };

type ContentBriefPickerProps = {
  seoProjectOptions: SeoProjectOption[];
  keywordsByProject: Record<string, KeywordOption[]>;
};

/**
 * Owns the whole generate → review → save state machine client-side.
 * Nothing is written to the database until "Save as Draft" — "Generate"
 * and "Regenerate" both just populate `brief` in memory via
 * generateContentBriefAction, which itself performs no DB write.
 */
export default function ContentBriefPicker({ seoProjectOptions, keywordsByProject }: ContentBriefPickerProps) {
  const router = useRouter();

  const [seoProjectId, setSeoProjectId] = useState(seoProjectOptions[0]?.id ?? "");
  const [keywordId, setKeywordId] = useState("");
  const [contentType, setContentType] = useState<ContentBriefType>("BLOG_POST");
  const [notes, setNotes] = useState("");

  const [brief, setBrief] = useState<ContentBriefOutput | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Phase 16 — the long-form step. `longFormFields` non-null means "show
  // LongFormContentReview instead of ContentBriefReview." Nothing here is
  // persisted until handleSaveLongForm; runGenerateLongForm/regenerate
  // never touch the database.
  const [longFormFields, setLongFormFields] = useState<LongFormEditableFields | null>(null);
  const [linkSuggestions, setLinkSuggestions] = useState<string[]>([]);
  const [isGeneratingLongForm, setIsGeneratingLongForm] = useState(false);
  const [isSavingLongForm, setIsSavingLongForm] = useState(false);

  const keywordOptions = useMemo(() => keywordsByProject[seoProjectId] ?? [], [keywordsByProject, seoProjectId]);

  async function runGenerate() {
    setError(null);
    setIsGenerating(true);
    const result = await generateContentBriefAction({
      seoProjectId,
      keywordId: keywordId || undefined,
      contentType,
      notes: notes || undefined,
    });
    setIsGenerating(false);

    if (!result.success) {
      setError(result.message);
      return;
    }
    setBrief(result.data);
  }

  async function handleSave() {
    if (!brief) return;
    setError(null);
    setIsSaving(true);
    const result = await saveContentBriefAction({
      seoProjectId,
      keywordId: keywordId || undefined,
      brief,
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
    const result = await generateLongFormFromBriefAction({
      seoProjectId,
      keywordId: keywordId || undefined,
      brief,
    });
    setIsGeneratingLongForm(false);

    if (!result.success) {
      setError(result.message);
      return;
    }
    setLinkSuggestions(result.data.internalLinkPlacementSuggestions);
    setLongFormFields({
      title: brief.title,
      metaTitle: brief.metaTitle,
      metaDescription: brief.metaDescription,
      body: formatLongFormContentAsMarkdown(result.data),
    });
  }

  async function handleSaveLongForm() {
    if (!longFormFields || !brief) return;
    setError(null);
    setIsSavingLongForm(true);
    const result = await saveLongFormAsNewContentAction({
      seoProjectId,
      keywordId: keywordId || undefined,
      brief,
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
        onRegenerate={runGenerateLongForm}
        onSave={handleSaveLongForm}
        onBackToBrief={backToBrief}
        isRegenerating={isGeneratingLongForm}
        isSaving={isSavingLongForm}
        error={error}
      />
    );
  }

  if (brief) {
    return (
      <ContentBriefReview
        brief={brief}
        onChange={setBrief}
        onRegenerate={runGenerate}
        onSave={handleSave}
        onGenerateLongForm={runGenerateLongForm}
        isGeneratingLongForm={isGeneratingLongForm}
        isRegenerating={isGenerating}
        isSaving={isSaving}
        error={error}
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

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="button" onClick={runGenerate} disabled={isGenerating || !seoProjectId}>
        {isGenerating ? "Generating..." : "Generate brief"}
      </Button>
    </div>
  );
}
