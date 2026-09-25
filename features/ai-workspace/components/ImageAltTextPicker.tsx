"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { startImageAltTextAction } from "@/features/ai-workspace/actions/image-alt-text.actions";
import { getAiGenerationJobAction } from "@/features/ai-workspace/actions/ai-generation-job.actions";
import ImageAltTextReview from "@/features/ai-workspace/components/ImageAltTextReview";
import { useAiGenerationLifecycle } from "@/features/ai-workspace/hooks/use-ai-generation-lifecycle";
import AiGenerationError from "@/features/ai-workspace/components/AiGenerationError";
import AiGenerationStatusNote from "@/features/ai-workspace/components/AiGenerationStatusNote";
import {
  buildDecorativeRecommendation,
  DESCRIPTION_REQUIRED_MESSAGE,
  hasEnoughImageEvidence,
  imageAltTextInputSchema,
  imageAltTextJobResultSchema,
  type ImageAltTextInput,
  type ImageAltTextJobResult,
} from "@/features/ai-workspace/schemas/image-alt-text.schema";
import { type LlmErrorType } from "@/lib/ai/providers/errors";

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";
const inputClassName =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const textareaClassName = `${inputClassName} min-h-24 resize-y`;

const MIME_LABELS: Record<string, string> = {
  "image/jpeg": "JPEG",
  "image/png": "PNG",
  "image/webp": "WebP",
  "image/gif": "GIF",
};

type SeoProjectOption = { id: string; name: string };

export type ImageOption = { id: string; fileName: string; mimeType: string; contentId: string | null; contentTitle: string | null };

type ImageAltTextPickerProps = {
  seoProjectOptions: SeoProjectOption[];
  imagesByProject: Record<string, ImageOption[]>;
};

/** Shown while no SEO project is chosen — a prompt to choose, never a claim that the project is invalid. */
export const SELECT_PROJECT_HINT = "Select an SEO project to see its images.";

/** Shown when the chosen project genuinely has no images. States the fact; never implies an error or a failed load. */
export const NO_IMAGES_MESSAGE =
  "This project has no images yet. Upload an image to the project or to one of its content records, then come back here.";

/**
 * Shown when generation completes but produces no valid result. A missing
 * description is refused before a job exists, so reaching this state means the
 * model's own output failed our deterministic grounding checks — never the
 * user's input.
 */
export const ALT_TEXT_NULL_RESULT_MESSAGE =
  "The generated alt text didn't meet our accuracy requirements — it referred to something your description doesn't mention, or read as marketing rather than description. Please try generating again.";

/**
 * The single sentence that keeps this tool honest about its own capability,
 * shown next to the description field. It is deliberately explicit that the AI
 * does not see the image.
 */
export const NO_VISION_NOTICE = "Describe what the image shows so the AI can create accurate alt text. The AI cannot see the image — your description is the only thing it works from.";

/**
 * Pure guard for the Generate button, extracted so it is directly
 * unit-testable without mounting the component (this repository has no React
 * rendering test setup). Calls the SAME evidence rule the server uses, so the
 * button and the boundary cannot drift apart.
 *
 * A decorative image never generates: its correct alt text is fixed by the
 * accessibility standard and is produced in code, not by a model.
 */
export function computeCanGenerateAltText(seoProjectId: string, fileId: string, imageDescription: string, isDecorative: boolean): boolean {
  if (isDecorative) return false;
  if (seoProjectId.trim() === "" || fileId.trim() === "") return false;
  return hasEnoughImageEvidence({ imageDescription });
}

/** Builds the exact request the action expects; blank optional fields become undefined rather than empty strings. */
export function buildAltTextRequest(seoProjectId: string, fileId: string, imageDescription: string, additionalContext: string): ImageAltTextInput {
  return {
    seoProjectId,
    fileId,
    imageDescription: imageDescription.trim(),
    additionalContext: additionalContext.trim() || undefined,
  };
}

/** The label shown for one image — file name, type, and the page it belongs to when it belongs to one. Never the storage key or the id. */
export function describeImageOption(image: ImageOption): string {
  const type = MIME_LABELS[image.mimeType] ?? image.mimeType;
  return image.contentTitle ? `${image.fileName} — ${type} — on "${image.contentTitle}"` : `${image.fileName} — ${type}`;
}

/**
 * The thirteenth AI Workspace tool's UI. Reuses the exact job→poll→stream
 * lifecycle every other picker uses. Review-and-copy only: no Apply, no Save,
 * and no write to File or Content anywhere.
 */
export default function ImageAltTextPicker({ seoProjectOptions, imagesByProject }: ImageAltTextPickerProps) {
  // Deliberately unselected — auto-selecting the first project would let a
  // user generate against one they never consciously chose. The server
  // re-derives and enforces ownership regardless of this value.
  const [seoProjectId, setSeoProjectId] = useState("");
  const [fileId, setFileId] = useState("");
  const [imageDescription, setImageDescription] = useState("");
  const [additionalContext, setAdditionalContext] = useState("");
  const [isDecorative, setIsDecorative] = useState(false);

  const [jobResult, setJobResult] = useState<ImageAltTextJobResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<LlmErrorType | null>(null);

  const imageOptions = seoProjectId ? (imagesByProject[seoProjectId] ?? []) : [];
  const selectedImage = imageOptions.find((option) => option.id === fileId);
  const decorative = buildDecorativeRecommendation();

  function applyResult(resultJson: unknown) {
    const parsed = imageAltTextJobResultSchema.safeParse(resultJson);
    if (!parsed.success) {
      setErrorType(null);
      setError("Received an unexpected result — please try generating again.");
      return;
    }
    setJobResult(parsed.data);
  }

  const lifecycle = useAiGenerationLifecycle(resumeJob);

  /** Reattaches to the job named in ?jobId=, whatever its status — same shape as every other picker's resumeJob. */
  async function resumeJob(jobId: string) {
    const poll = await getAiGenerationJobAction(jobId);
    if (!poll.success || !poll.data || poll.data.taskType !== "IMAGE_ALT_TEXT") {
      lifecycle.setActiveJob(null);
      return;
    }
    const job = poll.data;
    const parsedInput = imageAltTextInputSchema.safeParse(job.inputJson);
    if (!parsedInput.success) {
      lifecycle.setActiveJob(null);
      return;
    }
    setSeoProjectId(parsedInput.data.seoProjectId);
    setFileId(parsedInput.data.fileId);
    setImageDescription(parsedInput.data.imageDescription ?? "");
    setAdditionalContext(parsedInput.data.additionalContext ?? "");

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

  function handleProjectChange(value: string) {
    setSeoProjectId(value);
    // An image id from the previous project must never survive a project
    // change — the server would refuse it, but the UI should not offer it.
    setFileId("");
  }

  async function runGenerate() {
    if (!computeCanGenerateAltText(seoProjectId, fileId, imageDescription, isDecorative)) return;
    setError(null);
    setErrorType(null);
    setJobResult(null);
    setIsGenerating(true);
    const response = await startImageAltTextAction(buildAltTextRequest(seoProjectId, fileId, imageDescription, additionalContext));

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

  async function copyDecorativeAlt() {
    await navigator.clipboard.writeText(decorative.altText);
  }

  const canGenerate = computeCanGenerateAltText(seoProjectId, fileId, imageDescription, isDecorative);
  const needsDescription = Boolean(fileId) && !isDecorative && !hasEnoughImageEvidence({ imageDescription });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="seoProjectId" className="text-sm font-medium">
          SEO project
        </label>
        <select id="seoProjectId" className={selectClassName} value={seoProjectId} onChange={(e) => handleProjectChange(e.target.value)}>
          <option value="">Select an SEO project…</option>
          {seoProjectOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        {!seoProjectId && <p className="text-xs text-slate-500">{SELECT_PROJECT_HINT}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="fileId" className="text-sm font-medium">
          Image <span className="text-red-500">*</span>
        </label>
        <select id="fileId" className={selectClassName} value={fileId} onChange={(e) => setFileId(e.target.value)} disabled={!seoProjectId || imageOptions.length === 0}>
          <option value="">{seoProjectId ? "Select an image…" : "Select an SEO project first…"}</option>
          {imageOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {describeImageOption(option)}
            </option>
          ))}
        </select>
        {seoProjectId && imageOptions.length === 0 && <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">{NO_IMAGES_MESSAGE}</p>}
        {selectedImage && (
          <p className="text-xs text-slate-500">
            {MIME_LABELS[selectedImage.mimeType] ?? selectedImage.mimeType} ·{" "}
            {selectedImage.contentTitle ? (
              <>
                on <span className="font-medium text-slate-600">{selectedImage.contentTitle}</span>
              </>
            ) : (
              "not attached to a content record"
            )}
            . The file name is a label, not a description of the picture.
          </p>
        )}
      </div>

      {/*
        The decorative branch. Its answer is fixed by the accessibility
        standard, so it is produced in code with no AI call at all — asking a
        model would cost a generation and risk it inventing a description for
        an image that must not have one.
      */}
      <div className="flex flex-col gap-1.5 rounded-lg border border-slate-200 p-3">
        <div className="flex items-start gap-2">
          <input
            id="isDecorative"
            type="checkbox"
            className="mt-0.5 size-4 shrink-0 rounded border-input accent-slate-800 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            checked={isDecorative}
            onChange={(e) => setIsDecorative(e.target.checked)}
          />
          <label htmlFor="isDecorative" className="text-sm font-medium">
            This image is decorative
          </label>
        </div>
        <p className="pl-6 text-xs text-slate-500">
          Tick this if the image adds no information the surrounding text does not already give — a background pattern, a divider, or a purely ornamental photo.
        </p>

        {isDecorative && (
          <div className="mt-1 ml-6 flex flex-col gap-2 rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-medium tracking-wide text-slate-400 uppercase">Recommendation</p>
            <p className="text-sm text-slate-700">{decorative.recommendation}</p>
            <div className="flex items-center gap-2">
              <code className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800">alt=&quot;&quot;</code>
              <Button type="button" size="sm" variant="outline" onClick={copyDecorativeAlt}>
                Copy empty alt text
              </Button>
            </div>
            <p className="text-xs text-slate-500">No AI generation is needed for a decorative image — this is the accessibility standard&apos;s own answer.</p>
          </div>
        )}
      </div>

      {!isDecorative && (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="imageDescription" className="text-sm font-medium">
              What does this image show? <span className="text-red-500">*</span>
            </label>
            <p className="text-xs text-slate-500">{NO_VISION_NOTICE}</p>
            <textarea
              id="imageDescription"
              className={textareaClassName}
              value={imageDescription}
              onChange={(e) => setImageDescription(e.target.value)}
              maxLength={2000}
              placeholder="Describe the people, objects, setting, action, or visual information shown in the image."
              aria-describedby={needsDescription ? "imageDescription-required" : undefined}
            />
            {needsDescription && (
              <p id="imageDescription-required" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-700">
                {DESCRIPTION_REQUIRED_MESSAGE}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="additionalContext" className="text-sm font-medium">
              Additional context (optional)
            </label>
            <p className="text-xs text-slate-500">
              Anything else that matters — why the image is on the page, or any text that appears inside it. The AI cannot read text in the image, so type it here if it should be described.
            </p>
            <textarea id="additionalContext" className={textareaClassName} value={additionalContext} onChange={(e) => setAdditionalContext(e.target.value)} />
          </div>

          <AiGenerationError error={error} errorType={errorType} />

          <AiGenerationStatusNote isSwitchingProvider={lifecycle.isSwitchingProvider} />
          {isGenerating && !lifecycle.isSwitchingProvider && lifecycle.streamProgress !== null && <Progress value={lifecycle.streamProgress} aria-label="Generation progress" />}

          <div className="flex gap-2">
            <Button type="button" onClick={runGenerate} disabled={isGenerating || !canGenerate}>
              {isGenerating ? "Generating..." : "Generate alt text"}
            </Button>
            {isGenerating && (
              <Button type="button" variant="outline" onClick={handleCancel}>
                Cancel
              </Button>
            )}
          </div>

          {jobResult && jobResult.result === null && !isGenerating && <p className="text-sm text-slate-500">{ALT_TEXT_NULL_RESULT_MESSAGE}</p>}

          {jobResult && jobResult.result && <ImageAltTextReview result={jobResult.result} />}
        </>
      )}
    </div>
  );
}
