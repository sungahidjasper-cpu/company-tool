"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { savePressReleaseAsContentAction, startPressReleaseGenerationAction } from "@/features/ai-workspace/actions/press-release-generator.actions";
import { getAiGenerationJobAction } from "@/features/ai-workspace/actions/ai-generation-job.actions";
import PressReleaseReview from "@/features/ai-workspace/components/PressReleaseReview";
import { useAiGenerationLifecycle } from "@/features/ai-workspace/hooks/use-ai-generation-lifecycle";
import AiGenerationError from "@/features/ai-workspace/components/AiGenerationError";
import AiGenerationStatusNote from "@/features/ai-workspace/components/AiGenerationStatusNote";
import {
  pressReleaseGeneratorInputSchema,
  pressReleaseJobResultSchema,
  type PressReleaseGeneratorInput,
  type PressReleaseJobResult,
} from "@/features/ai-workspace/schemas/press-release-generator.schema";
import { type LlmErrorType } from "@/lib/ai/providers/errors";

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";
const inputClassName =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const textareaClassName = `${inputClassName} min-h-24 resize-y`;

type SeoProjectOption = { id: string; name: string };

type PressReleaseGeneratorPickerProps = {
  seoProjectOptions: SeoProjectOption[];
};

type FormState = {
  headline: string;
  keyFacts: string;
  quote: string;
  dateline: string;
  callToAction: string;
  notes: string;
};

const EMPTY_FORM: FormState = { headline: "", keyFacts: "", quote: "", dateline: "", callToAction: "", notes: "" };

/**
 * Shown when generation completes but produces no valid result. Deliberately
 * does not imply the supplied announcement details were insufficient — the
 * real cause is usually a fallback provider's response not meeting our
 * deterministic quality checks, not a lack of input (see the Press Release
 * Generator false-failure investigation).
 */
export const PRESS_RELEASE_NULL_RESULT_MESSAGE = "The AI response didn't meet our quality requirements this time. Please try generating again.";

/**
 * Pure guard for the Generate button's enabled state, extracted so it's
 * directly unit-testable without mounting the component (this repository
 * has no React component-rendering test setup — see
 * PressReleaseGeneratorPicker.logic.test.ts). The server
 * (startPressReleaseGenerationAction) is the real validation boundary
 * regardless — this only prevents the UI from submitting a form that's
 * missing either of the two genuinely required fields.
 */
export function computeCanGenerateRelease(headline: string, keyFacts: string): boolean {
  return headline.trim().length > 0 && keyFacts.trim().length > 0;
}

/**
 * Builds the exact request object startPressReleaseGenerationAction expects
 * from the form's own free-typed strings — optional fields become
 * undefined when blank (matching optionalString()'s own "" -> undefined
 * normalization) rather than being sent as empty strings, so the service
 * never treats "the user left this blank" as "the user supplied an empty
 * announcement quote."
 */
export function buildPressReleaseRequest(seoProjectId: string, form: FormState): PressReleaseGeneratorInput {
  return {
    seoProjectId,
    headline: form.headline.trim(),
    keyFacts: form.keyFacts.trim(),
    quote: form.quote.trim() || undefined,
    dateline: form.dateline.trim() || undefined,
    callToAction: form.callToAction.trim() || undefined,
    notes: form.notes.trim() || undefined,
  };
}

/** Phase B B5.1 — shown while no SEO project is chosen. A prompt to choose, never a claim that the project is invalid (only the server can determine that). */
export const SELECT_PROJECT_HINT = "Select an SEO project before generating.";

/**
 * The eighth AI Workspace tool's UI — a plain announcement form, NOT a
 * Content/page picker: this tool never grounds in or selects an existing
 * page. Reuses the exact same job→poll→stream generation lifecycle every
 * other AI Workspace tool's picker already uses. Generate-and-display, PLUS
 * an explicit "Save as Content" action — the release is only ever written
 * to Content when the reviewer clicks Save, never automatically.
 */
export default function PressReleaseGeneratorPicker({ seoProjectOptions }: PressReleaseGeneratorPickerProps) {
  const router = useRouter();
  // Phase B B5.1 — deliberately unselected. Auto-selecting the first project
  // let a user generate against a project they never consciously chose; the
  // server still re-derives and enforces ownership regardless of this value.
  const [seoProjectId, setSeoProjectId] = useState("");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const [jobResult, setJobResult] = useState<PressReleaseJobResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<LlmErrorType | null>(null);

  function applyResult(resultJson: unknown) {
    const parsed = pressReleaseJobResultSchema.safeParse(resultJson);
    if (!parsed.success) {
      setErrorType(null);
      setError("Received an unexpected result — please try regenerating.");
      return;
    }
    setJobResult(parsed.data);
  }

  const lifecycle = useAiGenerationLifecycle(resumeJob);

  /**
   * Reattaches to the job named in ?jobId=, whatever its current status —
   * same shape as every other AI Workspace picker's own resumeJob.
   */
  async function resumeJob(jobId: string) {
    const poll = await getAiGenerationJobAction(jobId);
    if (!poll.success || !poll.data || poll.data.taskType !== "PRESS_RELEASE_GENERATION") {
      lifecycle.setActiveJob(null);
      return;
    }
    const job = poll.data;
    const parsedInput = pressReleaseGeneratorInputSchema.safeParse(job.inputJson);
    if (!parsedInput.success) {
      lifecycle.setActiveJob(null);
      return;
    }
    setSeoProjectId(parsedInput.data.seoProjectId);
    setForm({
      headline: parsedInput.data.headline,
      keyFacts: parsedInput.data.keyFacts,
      quote: parsedInput.data.quote ?? "",
      dateline: parsedInput.data.dateline ?? "",
      callToAction: parsedInput.data.callToAction ?? "",
      notes: parsedInput.data.notes ?? "",
    });

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

  function updateField(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function runGenerate() {
    if (!computeCanGenerateRelease(form.headline, form.keyFacts)) return;
    setError(null);
    setErrorType(null);
    setJobResult(null);
    setIsGenerating(true);
    const response = await startPressReleaseGenerationAction(buildPressReleaseRequest(seoProjectId, form));

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

  /**
   * Saves the CURRENT job's own result as a real Content row. Reads the job
   * id from the lifecycle's own activeJobId — never anything the user could
   * tamper with; the server independently re-reads the job's actual
   * resultJson rather than trusting any text from this component's state.
   */
  async function handleSave() {
    const jobId = lifecycle.activeJobId;
    if (!jobId) return;
    setError(null);
    setIsSaving(true);
    const result = await savePressReleaseAsContentAction({ jobId });
    setIsSaving(false);
    if (!result.success) {
      setError(result.message);
      return;
    }
    toast.success("Saved as Content");
    router.push(`/seo/${seoProjectId}/content/${result.data.id}`);
  }

  const canGenerate = computeCanGenerateRelease(form.headline, form.keyFacts);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="seoProjectId" className="text-sm font-medium">
          SEO project
        </label>
        <select id="seoProjectId" className={selectClassName} value={seoProjectId} onChange={(e) => setSeoProjectId(e.target.value)}>
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
        <label htmlFor="headline" className="text-sm font-medium">
          Headline <span className="text-red-500">*</span>
        </label>
        <input id="headline" className={inputClassName} value={form.headline} onChange={(e) => updateField("headline", e.target.value)} placeholder="e.g. Acme Launches New Product Line" />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="keyFacts" className="text-sm font-medium">
          Announcement details <span className="text-red-500">*</span>
        </label>
        <p className="text-xs text-slate-500">The actual facts of the announcement — what happened, when, and why it matters. This is the only source of facts the AI will use.</p>
        <textarea id="keyFacts" className={textareaClassName} value={form.keyFacts} onChange={(e) => updateField("keyFacts", e.target.value)} maxLength={4000} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="quote" className="text-sm font-medium">
          Quote (optional)
        </label>
        <p className="text-xs text-slate-500">A real quote from a real named person. Leave blank if you don&apos;t have one — the AI will not invent one.</p>
        <input id="quote" className={inputClassName} value={form.quote} onChange={(e) => updateField("quote", e.target.value)} placeholder='e.g. "We are thrilled to..." — Jane Doe, CEO' />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="dateline" className="text-sm font-medium">
          Dateline / location (optional)
        </label>
        <p className="text-xs text-slate-500">Leave blank if not applicable — the AI will not guess a location.</p>
        <input id="dateline" className={inputClassName} value={form.dateline} onChange={(e) => updateField("dateline", e.target.value)} placeholder="e.g. Austin, TX" />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="callToAction" className="text-sm font-medium">
          Call to action / contact info (optional)
        </label>
        <input id="callToAction" className={inputClassName} value={form.callToAction} onChange={(e) => updateField("callToAction", e.target.value)} placeholder="e.g. Visit acme.example.com to learn more" />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="notes" className="text-sm font-medium">
          Additional notes (optional)
        </label>
        <textarea id="notes" className={textareaClassName} value={form.notes} onChange={(e) => updateField("notes", e.target.value)} />
      </div>

      <AiGenerationError error={error} errorType={errorType} />

      <AiGenerationStatusNote isSwitchingProvider={lifecycle.isSwitchingProvider} />
      {isGenerating && !lifecycle.isSwitchingProvider && lifecycle.streamProgress !== null && (
        <Progress value={lifecycle.streamProgress} aria-label="Generation progress" />
      )}

      <div className="flex gap-2">
        <Button type="button" onClick={runGenerate} disabled={isGenerating || !seoProjectId || !canGenerate}>
          {isGenerating ? "Generating..." : "Generate press release"}
        </Button>
        {isGenerating && (
          <Button type="button" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
        )}
      </div>

      {jobResult && jobResult.result === null && !isGenerating && (
        <p className="text-sm text-slate-500">{PRESS_RELEASE_NULL_RESULT_MESSAGE}</p>
      )}

      {jobResult && jobResult.result && (
        <PressReleaseReview result={jobResult.result} onSave={lifecycle.activeJobId ? handleSave : undefined} isSaving={isSaving} />
      )}
    </div>
  );
}
