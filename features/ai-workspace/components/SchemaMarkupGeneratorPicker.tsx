"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { startSchemaMarkupGenerationAction } from "@/features/ai-workspace/actions/schema-markup-generator.actions";
import { getAiGenerationJobAction } from "@/features/ai-workspace/actions/ai-generation-job.actions";
import { useAiGenerationLifecycle } from "@/features/ai-workspace/hooks/use-ai-generation-lifecycle";
import { schemaMarkupInputSchema, schemaMarkupOutputSchema, type SchemaMarkupOutput } from "@/features/ai-workspace/schemas/schema-markup-generator.schema";
import { type LlmErrorType } from "@/lib/ai/providers/errors";

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

const textareaClassName =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

type SeoProjectOption = { id: string; name: string };
type ContentOption = { id: string; title: string };

type SchemaMarkupGeneratorPickerProps = {
  seoProjectOptions: SeoProjectOption[];
  contentByProject: Record<string, ContentOption[]>;
};

/**
 * The third AI Workspace tool, following the exact generate→job→poll shape
 * ContentBriefPicker/ExistingBriefLongFormGenerator already use — but with
 * no save/apply step: this tool's output is never persisted (see
 * schema-markup-generator.service.ts's comment on why "generate + display +
 * copy" is the correct scope here). Nothing is written to the database by
 * this component at all.
 */
export default function SchemaMarkupGeneratorPicker({ seoProjectOptions, contentByProject }: SchemaMarkupGeneratorPickerProps) {
  const [seoProjectId, setSeoProjectId] = useState(seoProjectOptions[0]?.id ?? "");
  const [contentId, setContentId] = useState("");
  const [notes, setNotes] = useState("");

  const [result, setResult] = useState<SchemaMarkupOutput | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<LlmErrorType | null>(null);

  const contentOptions = useMemo(() => contentByProject[seoProjectId] ?? [], [contentByProject, seoProjectId]);

  function applyResult(resultJson: unknown) {
    const parsed = schemaMarkupOutputSchema.safeParse(resultJson);
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
   * same shape as ContentBriefPicker.tsx's own resumeJob. Declared AFTER
   * `lifecycle` above (referenced there only by name, via hoisting) so its
   * own references to `lifecycle` inside are ordinary closures, not forward
   * references — matching that file's exact declaration order.
   */
  async function resumeJob(jobId: string) {
    const poll = await getAiGenerationJobAction(jobId);
    if (!poll.success || !poll.data || poll.data.taskType !== "SCHEMA_MARKUP_GENERATION") {
      lifecycle.setActiveJob(null);
      return;
    }
    const job = poll.data;
    const parsedInput = schemaMarkupInputSchema.safeParse(job.inputJson);
    if (!parsedInput.success) {
      lifecycle.setActiveJob(null);
      return;
    }
    setSeoProjectId(parsedInput.data.seoProjectId);
    setContentId(parsedInput.data.contentId ?? "");
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

  async function runGenerate() {
    setError(null);
    setErrorType(null);
    setResult(null);
    setIsGenerating(true);
    const response = await startSchemaMarkupGenerationAction({
      seoProjectId,
      contentId: contentId || undefined,
      notes: notes || undefined,
    });

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

  async function copyJsonLd(exampleJsonLd: string) {
    await navigator.clipboard.writeText(exampleJsonLd);
    toast.success("Copied JSON-LD to clipboard");
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
            setContentId("");
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
          Ground in an existing page (optional)
        </label>
        <select id="contentId" className={selectClassName} value={contentId} onChange={(e) => setContentId(e.target.value)}>
          <option value="">No specific page — recommend for the business in general</option>
          {contentOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.title}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="notes" className="text-sm font-medium">
          Additional context (optional)
        </label>
        <textarea
          id="notes"
          className={textareaClassName}
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. this is a local service business with a single physical location"
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
        <Button type="button" onClick={runGenerate} disabled={isGenerating || !seoProjectId}>
          {isGenerating ? "Generating..." : "Generate schema markup"}
        </Button>
        {isGenerating && (
          <Button type="button" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
        )}
      </div>

      {result && result.recommendations.length === 0 && !isGenerating && (
        <p className="text-sm text-slate-500">No structured-data recommendations were returned. Try adding more context above and regenerating.</p>
      )}

      {result && result.recommendations.length > 0 && (
        <div className="flex flex-col gap-4">
          {result.recommendations.map((rec, index) => (
            <div key={`${rec.schemaType}-${index}`} className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-slate-800">{rec.schemaType}</p>
                <Button type="button" variant="outline" size="sm" onClick={() => copyJsonLd(rec.exampleJsonLd)}>
                  Copy JSON-LD
                </Button>
              </div>
              <p className="text-sm text-slate-500">{rec.reasoning}</p>
              <pre className="max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
                <code>{rec.exampleJsonLd}</code>
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
