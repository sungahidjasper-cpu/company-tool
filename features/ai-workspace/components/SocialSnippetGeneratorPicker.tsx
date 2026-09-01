"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { startSocialSnippetGeneratorAction } from "@/features/ai-workspace/actions/social-snippet-generator.actions";
import { getAiGenerationJobAction } from "@/features/ai-workspace/actions/ai-generation-job.actions";
import { useAiGenerationLifecycle } from "@/features/ai-workspace/hooks/use-ai-generation-lifecycle";
import {
  SOCIAL_SNIPPET_CHARACTER_LIMITS,
  SOCIAL_SNIPPET_PLATFORMS,
  socialSnippetGeneratorInputSchema,
  socialSnippetGenerationResultSchema,
  type SocialSnippetGenerationResult,
  type SocialSnippetPlatform,
} from "@/features/ai-workspace/schemas/social-snippet-generator.schema";
import { type LlmErrorType } from "@/lib/ai/providers/errors";

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

const textareaClassName =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

const PLATFORM_LABELS: Record<SocialSnippetPlatform, string> = {
  X: "X (Twitter)",
  LINKEDIN: "LinkedIn",
  FACEBOOK: "Facebook",
};

type SeoProjectOption = { id: string; name: string };
type ContentOption = { id: string; title: string };

type SocialSnippetGeneratorPickerProps = {
  seoProjectOptions: SeoProjectOption[];
  contentByProject: Record<string, ContentOption[]>;
};

/** A small local counter — CounterBadge (ContentBriefReview.tsx) lives alongside brief-specific rendering and isn't a reasonable shared import for a single number/limit display here. */
function CharacterCount({ platform, count }: { platform: SocialSnippetPlatform; count: number }) {
  const limit = SOCIAL_SNIPPET_CHARACTER_LIMITS[platform];
  if (limit === null) {
    return <span className="text-xs text-slate-400">{count.toLocaleString()} characters</span>;
  }
  const overLimit = count > limit;
  return (
    <span className={`text-xs ${overLimit ? "font-medium text-red-600" : "text-slate-400"}`}>
      {count.toLocaleString()} / {limit.toLocaleString()} characters
    </span>
  );
}

/**
 * The fifth AI Workspace tool, following the exact generate→job→poll shape
 * InternalLinkAnalyzerPicker.tsx already uses — contentId is REQUIRED here
 * too, since every snippet promotes a specific, real piece of content. Adds
 * a platform multi-select (new selector type) and an optional notes field.
 * No save/apply step: this tool's output is never persisted or auto-posted
 * anywhere (see social-snippet-generator.service.ts's own comment on why).
 */
export default function SocialSnippetGeneratorPicker({ seoProjectOptions, contentByProject }: SocialSnippetGeneratorPickerProps) {
  const [seoProjectId, setSeoProjectId] = useState(seoProjectOptions[0]?.id ?? "");
  const contentOptions = useMemo(() => contentByProject[seoProjectId] ?? [], [contentByProject, seoProjectId]);
  const [contentId, setContentId] = useState(contentOptions[0]?.id ?? "");
  const [platforms, setPlatforms] = useState<SocialSnippetPlatform[]>([...SOCIAL_SNIPPET_PLATFORMS]);
  const [notes, setNotes] = useState("");

  const [result, setResult] = useState<SocialSnippetGenerationResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<LlmErrorType | null>(null);

  function applyResult(resultJson: unknown) {
    const parsed = socialSnippetGenerationResultSchema.safeParse(resultJson);
    if (!parsed.success) {
      setErrorType(null);
      setError("Received an unexpected result — please try regenerating.");
      return;
    }
    setResult(parsed.data);
  }

  const lifecycle = useAiGenerationLifecycle(resumeJob);

  /**
   * Reattaches to the job named in ?jobId=, whatever its current status —
   * same shape as InternalLinkAnalyzerPicker.tsx's own resumeJob. Declared
   * AFTER `lifecycle` above (referenced there only by name, via hoisting)
   * so its own references to `lifecycle` inside are ordinary closures, not
   * forward references.
   */
  async function resumeJob(jobId: string) {
    const poll = await getAiGenerationJobAction(jobId);
    if (!poll.success || !poll.data || poll.data.taskType !== "SOCIAL_SNIPPET_GENERATION") {
      lifecycle.setActiveJob(null);
      return;
    }
    const job = poll.data;
    const parsedInput = socialSnippetGeneratorInputSchema.safeParse(job.inputJson);
    if (!parsedInput.success) {
      lifecycle.setActiveJob(null);
      return;
    }
    setSeoProjectId(parsedInput.data.seoProjectId);
    setContentId(parsedInput.data.contentId);
    setPlatforms(parsedInput.data.platforms);
    setNotes(parsedInput.data.notes ?? "");

    if (job.status === "SUCCEEDED") {
      applyResult(job.resultJson);
      return;
    }
    if (job.status === "FAILED") {
      setErrorType(job.errorType);
      setError(job.errorMessage ?? "Generation failed.");
      return;
    }
    if (job.status === "PENDING" || job.status === "RUNNING") {
      setIsGenerating(true);
      lifecycle.openGenerationStream(jobId);
      lifecycle.pollGenerationJob(jobId, {
        onSucceeded: applyResult,
        onFailed: (type, message) => {
          setErrorType(type);
          setError(message);
        },
        onSettled: () => {
          setIsGenerating(false);
          lifecycle.closeGenerationStream();
        },
      });
    }
  }

  function togglePlatform(platform: SocialSnippetPlatform, checked: boolean) {
    setPlatforms((prev) => (checked ? [...prev, platform] : prev.filter((p) => p !== platform)));
  }

  async function runGenerate() {
    setError(null);
    setErrorType(null);
    setResult(null);
    setIsGenerating(true);
    const response = await startSocialSnippetGeneratorAction({ seoProjectId, contentId, platforms, notes: notes.trim() || undefined });

    if (!response.success) {
      setIsGenerating(false);
      setError(response.message);
      return;
    }

    lifecycle.setActiveJob(response.data.jobId);
    lifecycle.openGenerationStream(response.data.jobId);
    lifecycle.pollGenerationJob(response.data.jobId, {
      onSucceeded: applyResult,
      onFailed: (type, message) => {
        setErrorType(type);
        setError(message);
      },
      onSettled: () => {
        setIsGenerating(false);
        lifecycle.closeGenerationStream();
      },
    });
  }

  function handleCancel() {
    lifecycle.cancel(() => setIsGenerating(false));
  }

  async function copySnippet(text: string) {
    await navigator.clipboard.writeText(text);
    toast.success("Copied snippet to clipboard");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="seoProjectId" className="text-sm font-medium">
          SEO project
        </label>
        <select
          id="seoProjectId"
          className={selectClassName}
          value={seoProjectId}
          onChange={(e) => {
            setSeoProjectId(e.target.value);
            setContentId(contentByProject[e.target.value]?.[0]?.id ?? "");
          }}
        >
          {seoProjectOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="contentId" className="text-sm font-medium">
          Content to promote
        </label>
        <select id="contentId" className={selectClassName} value={contentId} onChange={(e) => setContentId(e.target.value)}>
          {contentOptions.length === 0 && <option value="">No content in this project yet</option>}
          {contentOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.title}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">Platforms</p>
        <div className="flex flex-wrap gap-4">
          {SOCIAL_SNIPPET_PLATFORMS.map((platform) => (
            <label key={platform} className="flex items-center gap-2 text-sm">
              <Checkbox checked={platforms.includes(platform)} onCheckedChange={(value) => togglePlatform(platform, value === true)} />
              {PLATFORM_LABELS[platform]}
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="notes" className="text-sm font-medium">
          Additional instructions <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <textarea
          id="notes"
          className={textareaClassName}
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. lean into the practical-tips angle"
        />
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
          {errorType && <span className="ml-1 text-xs text-red-500">({errorType})</span>}
        </div>
      )}

      {isGenerating && lifecycle.streamProgress !== null && <Progress value={lifecycle.streamProgress} aria-label="Generation progress" />}

      <div className="flex gap-2">
        <Button type="button" onClick={runGenerate} disabled={isGenerating || !seoProjectId || !contentId || platforms.length === 0}>
          {isGenerating ? "Generating..." : "Generate snippets"}
        </Button>
        {isGenerating && (
          <Button type="button" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
        )}
      </div>

      {result && result.snippets.length === 0 && !isGenerating && (
        <p className="text-sm text-slate-500">No snippets were generated for the selected platforms. Try a different piece of content, or select different platforms.</p>
      )}

      {result && result.snippets.length > 0 && (
        <div className="flex flex-col gap-3">
          {result.snippets.map((snippet, index) => (
            <div key={`${snippet.platform}-${index}`} className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-slate-800">{PLATFORM_LABELS[snippet.platform]}</p>
                <Button type="button" variant="outline" size="sm" onClick={() => copySnippet(snippet.text)}>
                  Copy
                </Button>
              </div>
              <p className="whitespace-pre-wrap text-sm text-slate-600">{snippet.text}</p>
              <CharacterCount platform={snippet.platform} count={snippet.characterCount} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
