"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { cancelAiGenerationJobAction, getAiGenerationJobAction } from "@/features/ai-workspace/actions/ai-generation-job.actions";
import { parsePreviewFields, type JsonValue } from "@/features/ai-workspace/services/partial-json-preview.service";
import { type LlmErrorType } from "@/lib/ai/providers/errors";

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_MS = 5 * 60 * 1000;

export type PollGenerationJobHandlers = {
  onSucceeded: (resultJson: unknown) => void;
  onFailed: (errorType: LlmErrorType | null, message: string) => void;
  onSettled: () => void;
};

/**
 * Phase 30 Stage 11 — the generic job-lifecycle mechanics shared by every
 * AiGenerationJob-backed AI Workspace tool, extracted out of
 * ContentBriefPicker.tsx and ExistingBriefLongFormGenerator.tsx (which had
 * each independently implemented the exact same ?jobId=-mirroring,
 * streaming, polling, and cancel logic since Stage 10). What's intentionally
 * NOT here, and stays per-tool: the body of "what does resuming a job of
 * MY task type actually mean" (which AiTaskType, which validator, which
 * fields to restore) and how a caller chooses to render an error — this
 * hook only owns the plumbing every tool needs identically, not the
 * task-specific interpretation of a job's payload.
 */
export function useAiGenerationLifecycle(onResumeJob: (jobId: string) => void) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [streamCharCount, setStreamCharCount] = useState<number | null>(null);
  const [streamProgress, setStreamProgress] = useState<number | null>(null);
  const [isSwitchingProvider, setIsSwitchingProvider] = useState(false);
  const [previewFields, setPreviewFields] = useState<Record<string, JsonValue> | null>(null);

  const streamRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Kept current every render so the mount-only effect below always calls
  // the latest onResumeJob without needing it in a dependency array (which
  // would otherwise re-run the "only once, on mount" resume trigger).
  const onResumeJobRef = useRef(onResumeJob);
  useEffect(() => {
    onResumeJobRef.current = onResumeJob;
  });

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      streamRef.current?.close();
    };
  }, []);

  function setActiveJob(jobId: string | null) {
    setActiveJobId(jobId);
    const params = new URLSearchParams(searchParams.toString());
    if (jobId) params.set("jobId", jobId);
    else params.delete("jobId");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  /**
   * Best-effort only: if streaming is disabled server-side, this endpoint
   * 404s and onerror below just closes the connection, leaving the
   * existing poll-only experience completely unaffected. Never awaited,
   * never a dependency of anything that detects job completion — that
   * stays pollGenerationJob's job alone.
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
    source.addEventListener("done", () => source.close());
    source.onerror = () => source.close();
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
   * Polls an AiGenerationJob until it settles. A max poll duration (well
   * above the documented worst case with the provider layer's own retries)
   * stops an abandoned/stuck poll from running forever rather than leaving
   * it open-ended.
   */
  function pollGenerationJob(jobId: string, handlers: PollGenerationJobHandlers) {
    if (pollRef.current) clearInterval(pollRef.current);
    const startedAt = Date.now();

    pollRef.current = setInterval(async () => {
      if (Date.now() - startedAt > MAX_POLL_MS) {
        if (pollRef.current) clearInterval(pollRef.current);
        handlers.onSettled();
        handlers.onFailed(null, "This is taking longer than expected. Please check back shortly or try again.");
        return;
      }

      const poll = await getAiGenerationJobAction(jobId);
      if (!poll.success) {
        if (pollRef.current) clearInterval(pollRef.current);
        handlers.onSettled();
        handlers.onFailed(null, poll.message);
        return;
      }
      if (!poll.data) return;

      if (poll.data.status === "FAILED") {
        if (pollRef.current) clearInterval(pollRef.current);
        handlers.onSettled();
        handlers.onFailed(poll.data.errorType, poll.data.errorMessage ?? "Generation failed.");
        return;
      }

      if (poll.data.status === "SUCCEEDED") {
        if (pollRef.current) clearInterval(pollRef.current);
        handlers.onSettled();
        handlers.onSucceeded(poll.data.resultJson);
      }
    }, POLL_INTERVAL_MS);
  }

  // Resume-on-mount: reattaches to the job named in ?jobId=, if any, exactly
  // once. Deferred via setTimeout, matching this codebase's existing
  // WebsiteAnalysisWorkspace.tsx pollJob pattern — onResumeJob's own
  // setState calls happen after an await, not synchronously in the effect
  // body, so this must run as a genuinely separate task, not a direct call.
  useEffect(() => {
    const resumeJobId = searchParams.get("jobId");
    if (!resumeJobId) return;
    const timeoutId = setTimeout(() => {
      onResumeJobRef.current(resumeJobId);
    }, 0);
    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** A soft cancel — see cancelAiGenerationJob's own comment (lib/jobs/ai-generation-job-table.ts) for exactly what this does and doesn't stop. onCancelled lets the caller reset its own "isGenerating"-style flag(s). */
  async function cancel(onCancelled: () => void) {
    if (!activeJobId) return;
    const jobId = activeJobId;
    if (pollRef.current) clearInterval(pollRef.current);
    closeGenerationStream();
    onCancelled();
    setActiveJob(null);
    await cancelAiGenerationJobAction(jobId);
    toast.success("Generation cancelled.");
  }

  return {
    activeJobId,
    setActiveJob,
    streamCharCount,
    streamProgress,
    isSwitchingProvider,
    previewFields,
    openGenerationStream,
    closeGenerationStream,
    pollGenerationJob,
    cancel,
  };
}

export type AiGenerationLifecycle = ReturnType<typeof useAiGenerationLifecycle>;
