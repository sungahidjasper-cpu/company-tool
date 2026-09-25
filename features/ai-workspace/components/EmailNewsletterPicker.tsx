"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { saveEmailNewsletterAsContentAction, startEmailNewsletterAction } from "@/features/ai-workspace/actions/email-newsletter.actions";
import { getAiGenerationJobAction } from "@/features/ai-workspace/actions/ai-generation-job.actions";
import EmailNewsletterReview from "@/features/ai-workspace/components/EmailNewsletterReview";
import { useAiGenerationLifecycle } from "@/features/ai-workspace/hooks/use-ai-generation-lifecycle";
import AiGenerationError from "@/features/ai-workspace/components/AiGenerationError";
import AiGenerationStatusNote from "@/features/ai-workspace/components/AiGenerationStatusNote";
import {
  emailNewsletterInputSchema,
  emailNewsletterJobResultSchema,
  hasEnoughSourceMaterial,
  INSUFFICIENT_SOURCE_MATERIAL_MESSAGE,
  type EmailNewsletterInput,
  type EmailNewsletterJobResult,
} from "@/features/ai-workspace/schemas/email-newsletter.schema";
import { type LlmErrorType } from "@/lib/ai/providers/errors";

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";
const inputClassName =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const textareaClassName = `${inputClassName} min-h-24 resize-y`;

type SeoProjectOption = { id: string; name: string };

/** What the route knows about each selectable Content row — `hasBody` drives the source-material guidance, and is computed server-side. */
export type ContentOption = { id: string; title: string; hasBody: boolean };

type EmailNewsletterPickerProps = {
  seoProjectOptions: SeoProjectOption[];
  contentByProject: Record<string, ContentOption[]>;
  initialSeoProjectId?: string;
  initialContentId?: string;
};

type FormState = {
  audience: string;
  callToAction: string;
  campaignAngle: string;
  additionalContext: string;
  notes: string;
};

const EMPTY_FORM: FormState = { audience: "", callToAction: "", campaignAngle: "", additionalContext: "", notes: "" };

/**
 * Shown when generation completes but produces no valid result. Deliberately
 * does not imply the source content was insufficient — an empty source is
 * refused before a job is ever created (see INSUFFICIENT_SOURCE_MATERIAL_MESSAGE),
 * so reaching this state means the model's own output failed our deterministic
 * grounding checks.
 */
export const NEWSLETTER_NULL_RESULT_MESSAGE = "The AI response didn't meet our quality requirements this time. Please try generating again.";

/** Shown while no SEO project is chosen — a prompt to choose, never a claim that the project is invalid. */
export const SELECT_PROJECT_HINT = "Select an SEO project before drafting.";

/**
 * Pure guard for the Generate button's enabled state, extracted so it is
 * directly unit-testable without mounting the component (this repository has
 * no React rendering test setup). The server action is the real validation
 * boundary regardless — this only prevents the UI from submitting a request
 * that is already known to be ungroundable.
 *
 * The source-material rule is the SAME function the server uses
 * (hasEnoughSourceMaterial), so the button and the boundary can never drift
 * apart into "enabled here, refused there".
 */
export function computeCanDraft(seoProjectId: string, contentId: string, selected: ContentOption | undefined, additionalContext: string): boolean {
  if (seoProjectId.trim() === "" || contentId.trim() === "") return false;
  if (!selected) return false;
  return hasEnoughSourceMaterial({ body: selected.hasBody ? "present" : "", additionalContext });
}

/**
 * Builds the exact request startEmailNewsletterAction expects — optional
 * fields become undefined when blank (matching optionalString()'s own
 * "" -> undefined normalization) rather than being sent as empty strings, so
 * the service never treats "left blank" as "supplied an empty value".
 */
export function buildNewsletterRequest(seoProjectId: string, contentId: string, form: FormState): EmailNewsletterInput {
  return {
    seoProjectId,
    contentId,
    audience: form.audience.trim() || undefined,
    callToAction: form.callToAction.trim() || undefined,
    campaignAngle: form.campaignAngle.trim() || undefined,
    additionalContext: form.additionalContext.trim() || undefined,
    notes: form.notes.trim() || undefined,
  };
}

/**
 * The twelfth AI Workspace tool's UI. Reuses the exact job→poll→stream
 * lifecycle every other picker uses. Draft-and-display-and-copy, PLUS an
 * explicit "Save as Content" action (the tool still has no Send, Schedule or
 * recipient control anywhere, and none is planned — it has no email
 * provider): the newsletter is only ever written to Content when the
 * reviewer clicks Save, never automatically on generation.
 */
export default function EmailNewsletterPicker({ seoProjectOptions, contentByProject, initialSeoProjectId = "", initialContentId = "" }: EmailNewsletterPickerProps) {
  const router = useRouter();
  // Deliberately unselected unless a contextual hand-off preselected one.
  // Auto-choosing the first project would let a user draft against a project
  // they never consciously chose; the server re-derives and enforces
  // ownership regardless of this value.
  const [seoProjectId, setSeoProjectId] = useState(initialSeoProjectId);
  const [contentId, setContentId] = useState(initialContentId);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const [jobResult, setJobResult] = useState<EmailNewsletterJobResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<LlmErrorType | null>(null);

  const contentOptions = seoProjectId ? (contentByProject[seoProjectId] ?? []) : [];
  const selectedContent = contentOptions.find((option) => option.id === contentId);

  function applyResult(resultJson: unknown) {
    const parsed = emailNewsletterJobResultSchema.safeParse(resultJson);
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
    if (!poll.success || !poll.data || poll.data.taskType !== "EMAIL_NEWSLETTER") {
      lifecycle.setActiveJob(null);
      return;
    }
    const job = poll.data;
    const parsedInput = emailNewsletterInputSchema.safeParse(job.inputJson);
    if (!parsedInput.success) {
      lifecycle.setActiveJob(null);
      return;
    }
    setSeoProjectId(parsedInput.data.seoProjectId);
    setContentId(parsedInput.data.contentId);
    setForm({
      audience: parsedInput.data.audience ?? "",
      callToAction: parsedInput.data.callToAction ?? "",
      campaignAngle: parsedInput.data.campaignAngle ?? "",
      additionalContext: parsedInput.data.additionalContext ?? "",
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

  function handleProjectChange(value: string) {
    setSeoProjectId(value);
    // A content id from the previous project must never survive a project
    // change — the server would refuse it, but the UI should not offer it.
    setContentId("");
  }

  async function runGenerate() {
    if (!computeCanDraft(seoProjectId, contentId, selectedContent, form.additionalContext)) return;
    setError(null);
    setErrorType(null);
    setJobResult(null);
    setIsGenerating(true);
    const response = await startEmailNewsletterAction(buildNewsletterRequest(seoProjectId, contentId, form));

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
   * id from the lifecycle's own activeJobId — the same id ?jobId= mirrors —
   * never anything the user could tamper with; the server independently
   * re-reads the job's actual resultJson rather than trusting any text from
   * this component's own state.
   */
  async function handleSave() {
    const jobId = lifecycle.activeJobId;
    if (!jobId) return;
    setError(null);
    setIsSaving(true);
    const result = await saveEmailNewsletterAsContentAction({ jobId });
    setIsSaving(false);
    if (!result.success) {
      setError(result.message);
      return;
    }
    toast.success("Saved as Content");
    router.push(`/seo/${seoProjectId}/content/${result.data.id}`);
  }

  const canDraft = computeCanDraft(seoProjectId, contentId, selectedContent, form.additionalContext);
  const needsMoreMaterial = Boolean(selectedContent && !selectedContent.hasBody && form.additionalContext.trim() === "");

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
        <label htmlFor="contentId" className="text-sm font-medium">
          Source content <span className="text-red-500">*</span>
        </label>
        <p className="text-xs text-slate-500">The newsletter is drafted from this page. Its text is the factual basis — nothing is added to it.</p>
        <select id="contentId" className={selectClassName} value={contentId} onChange={(e) => setContentId(e.target.value)} disabled={!seoProjectId}>
          <option value="">{seoProjectId ? "Select a content record…" : "Select an SEO project first…"}</option>
          {contentOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.title}
              {option.hasBody ? "" : " (no body text yet)"}
            </option>
          ))}
        </select>
        {seoProjectId && contentOptions.length === 0 && <p className="text-xs text-slate-500">This project has no content records yet.</p>}
      </div>

      {needsMoreMaterial && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-700">{INSUFFICIENT_SOURCE_MATERIAL_MESSAGE}</p>}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="additionalContext" className="text-sm font-medium">
          Additional context {needsMoreMaterial ? <span className="text-red-500">*</span> : "(optional)"}
        </label>
        <p className="text-xs text-slate-500">Your own material to draft from. Treated as fact, exactly like the source page — the AI will not add to it.</p>
        <textarea
          id="additionalContext"
          className={textareaClassName}
          value={form.additionalContext}
          onChange={(e) => updateField("additionalContext", e.target.value)}
          maxLength={4000}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="audience" className="text-sm font-medium">
          Audience (optional)
        </label>
        <input id="audience" className={inputClassName} value={form.audience} onChange={(e) => updateField("audience", e.target.value)} placeholder="e.g. First-time self storage investors" />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="campaignAngle" className="text-sm font-medium">
          Campaign angle / newsletter purpose (optional)
        </label>
        <input
          id="campaignAngle"
          className={inputClassName}
          value={form.campaignAngle}
          onChange={(e) => updateField("campaignAngle", e.target.value)}
          placeholder="e.g. Monthly roundup introducing our new guide"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="callToAction" className="text-sm font-medium">
          Call to action (optional)
        </label>
        <p className="text-xs text-slate-500">Your own wording is used as given. Leave blank and the draft simply points readers to the source page — it will not invent an offer or deadline.</p>
        <input
          id="callToAction"
          className={inputClassName}
          value={form.callToAction}
          onChange={(e) => updateField("callToAction", e.target.value)}
          placeholder="e.g. Read the full guide on our site"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="notes" className="text-sm font-medium">
          Additional notes (optional)
        </label>
        <textarea id="notes" className={textareaClassName} value={form.notes} onChange={(e) => updateField("notes", e.target.value)} />
      </div>

      <AiGenerationError error={error} errorType={errorType} />

      <AiGenerationStatusNote isSwitchingProvider={lifecycle.isSwitchingProvider} />
      {isGenerating && !lifecycle.isSwitchingProvider && lifecycle.streamProgress !== null && <Progress value={lifecycle.streamProgress} aria-label="Generation progress" />}

      <div className="flex gap-2">
        <Button type="button" onClick={runGenerate} disabled={isGenerating || !canDraft}>
          {isGenerating ? "Generating..." : "Draft newsletter"}
        </Button>
        {isGenerating && (
          <Button type="button" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
        )}
      </div>

      {jobResult && jobResult.result === null && !isGenerating && <p className="text-sm text-slate-500">{NEWSLETTER_NULL_RESULT_MESSAGE}</p>}

      {jobResult && jobResult.result && (
        <EmailNewsletterReview result={jobResult.result} onSave={lifecycle.activeJobId ? handleSave : undefined} isSaving={isSaving} />
      )}
    </div>
  );
}
