"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { getAiGenerationJobAction } from "@/features/ai-workspace/actions/ai-generation-job.actions";
import { startLongFormGenerationAction, updateLongFormContentAction } from "@/features/ai-workspace/actions/long-form-content.actions";
import LongFormContentReview, { type LongFormDraftExtras, type LongFormEditableFields } from "@/features/ai-workspace/components/LongFormContentReview";
import type { ContentBriefSettings } from "@/features/ai-workspace/schemas/content-brief-settings.schema";
import { formatLongFormContentAsMarkdown, longFormContentOutputSchema } from "@/features/ai-workspace/schemas/long-form-content.schema";

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_MS = 5 * 60 * 1000;

type ExistingBriefLongFormGeneratorProps = {
  contentId: string;
  seoProjectId: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  /** Phase 21 — the settings originally used to generate this content's brief, read back from Content.aiBriefDetails.briefSettings by the page. */
  settings: ContentBriefSettings;
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
  settings,
}: ExistingBriefLongFormGeneratorProps) {
  const router = useRouter();
  const [longFormFields, setLongFormFields] = useState<LongFormEditableFields | null>(null);
  const [linkSuggestions, setLinkSuggestions] = useState<string[]>([]);
  const [draftExtras, setDraftExtras] = useState<LongFormDraftExtras | undefined>(undefined);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function runGenerate() {
    setError(null);
    setIsGenerating(true);
    const result = await startLongFormGenerationAction({ mode: "fromContent", contentId });

    if (!result.success) {
      setIsGenerating(false);
      setError(result.message);
      return;
    }

    if (pollRef.current) clearInterval(pollRef.current);
    const startedAt = Date.now();
    pollRef.current = setInterval(async () => {
      if (Date.now() - startedAt > MAX_POLL_MS) {
        if (pollRef.current) clearInterval(pollRef.current);
        setIsGenerating(false);
        setError("This is taking longer than expected. Please check back shortly or try again.");
        return;
      }

      const poll = await getAiGenerationJobAction(result.data.jobId);
      if (!poll.success) {
        if (pollRef.current) clearInterval(pollRef.current);
        setIsGenerating(false);
        setError(poll.message);
        return;
      }
      if (!poll.data) return;

      if (poll.data.status === "FAILED") {
        if (pollRef.current) clearInterval(pollRef.current);
        setIsGenerating(false);
        setError(poll.data.errorMessage ?? "Generation failed.");
        return;
      }

      if (poll.data.status === "SUCCEEDED") {
        if (pollRef.current) clearInterval(pollRef.current);
        setIsGenerating(false);
        const parsed = longFormContentOutputSchema.safeParse(poll.data.resultJson);
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
          title,
          metaTitle,
          metaDescription,
          body: formatLongFormContentAsMarkdown(parsed.data, settings.sections.cta ? settings.cta : undefined),
        });
      }
    }, POLL_INTERVAL_MS);
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
        draftExtras={draftExtras}
        targetWordCount={settings.wordCount}
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
