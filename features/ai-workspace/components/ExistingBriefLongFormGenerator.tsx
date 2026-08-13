"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { generateLongFormFromContentAction, updateLongFormContentAction } from "@/features/ai-workspace/actions/long-form-content.actions";
import LongFormContentReview, { type LongFormEditableFields } from "@/features/ai-workspace/components/LongFormContentReview";
import { formatLongFormContentAsMarkdown } from "@/features/ai-workspace/schemas/long-form-content.schema";

type ExistingBriefLongFormGeneratorProps = {
  contentId: string;
  seoProjectId: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
};

/**
 * The "already-saved brief" entry point — for a Content row Phase 15's
 * saveContentBriefAction already created. Generation only ever starts on
 * an explicit click (never on page load/mount), and nothing is persisted
 * until "Save as Draft," which performs a scoped UPDATE on this exact
 * row (see updateLongFormContentAction) — never a new Content row.
 */
export default function ExistingBriefLongFormGenerator({
  contentId,
  seoProjectId,
  title,
  metaTitle,
  metaDescription,
}: ExistingBriefLongFormGeneratorProps) {
  const router = useRouter();
  const [longFormFields, setLongFormFields] = useState<LongFormEditableFields | null>(null);
  const [linkSuggestions, setLinkSuggestions] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runGenerate() {
    setError(null);
    setIsGenerating(true);
    const result = await generateLongFormFromContentAction(contentId);
    setIsGenerating(false);

    if (!result.success) {
      setError(result.message);
      return;
    }
    setLinkSuggestions(result.data.internalLinkPlacementSuggestions);
    setLongFormFields({
      title,
      metaTitle,
      metaDescription,
      body: formatLongFormContentAsMarkdown(result.data),
    });
  }

  async function handleSave() {
    if (!longFormFields) return;
    setError(null);
    setIsSaving(true);
    const result = await updateLongFormContentAction({ contentId, ...longFormFields });
    setIsSaving(false);

    if (!result.success) {
      setError(result.message);
      return;
    }
    toast.success("Draft saved");
    router.push(`/seo/${seoProjectId}/content/${contentId}`);
  }

  if (longFormFields) {
    return (
      <LongFormContentReview
        fields={longFormFields}
        onChange={setLongFormFields}
        internalLinkPlacementSuggestions={linkSuggestions}
        onRegenerate={runGenerate}
        onSave={handleSave}
        isRegenerating={isGenerating}
        isSaving={isSaving}
        error={error}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-500">
        This generates a full draft article from the brief already saved for &quot;{title}.&quot; Nothing is saved until you review it and click Save as Draft.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="button" onClick={runGenerate} disabled={isGenerating}>
        {isGenerating ? "Generating..." : "Generate Long-Form Content"}
      </Button>
    </div>
  );
}
