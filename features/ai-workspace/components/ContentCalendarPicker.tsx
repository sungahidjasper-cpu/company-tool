"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { saveContentCalendarAction, startContentCalendarAction } from "@/features/ai-workspace/actions/content-calendar.actions";
import { getAiGenerationJobAction } from "@/features/ai-workspace/actions/ai-generation-job.actions";
import { useAiGenerationLifecycle } from "@/features/ai-workspace/hooks/use-ai-generation-lifecycle";
import AiGenerationError from "@/features/ai-workspace/components/AiGenerationError";
import AiGenerationStatusNote from "@/features/ai-workspace/components/AiGenerationStatusNote";
import ContentCalendarReview from "@/features/ai-workspace/components/ContentCalendarReview";
import {
  CADENCE_LABELS,
  CALENDAR_CADENCES,
  checkDateRange,
  contentCalendarInputSchema,
  contentCalendarJobResultSchema,
  type CalendarCadence,
  type CalendarTopicSource,
  type ContentCalendarInput,
  type ContentCalendarResult,
  type ProposedCalendarEntry,
} from "@/features/ai-workspace/schemas/content-calendar.schema";
import { type LlmErrorType } from "@/lib/ai/providers/errors";

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";
const textareaClassName =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 min-h-24 resize-y";

type SeoProjectOption = { id: string; name: string };
export type ClusterOption = { id: string; name: string; keywordCount: number };

/** What the project actually has to plan from — decided server-side, used to explain an empty state honestly. */
export type ProjectPlanningData = { keywordCount: number; contentCount: number; clusters: ClusterOption[] };

type ContentCalendarPickerProps = {
  seoProjectOptions: SeoProjectOption[];
  planningDataByProject: Record<string, ProjectPlanningData>;
};

export const SELECT_PROJECT_HINT = "Select an SEO project to plan for.";

export const TOPIC_SOURCE_LABELS: Record<CalendarTopicSource, string> = {
  PROJECT_DATA: "This project's keywords and existing pages",
  TOPIC_CLUSTER: "One of this project's topic clusters",
  USER_TOPICS: "Topics I type myself",
};

/**
 * Pure guard for the Generate button, extracted so it is directly
 * unit-testable without mounting the component (this repository has no React
 * rendering test setup).
 *
 * Uses the SAME `checkDateRange` the server uses, so the button and the
 * boundary can never disagree about whether a range is valid.
 */
export function computeCanGenerateCalendar(input: {
  seoProjectId: string;
  name: string;
  startDate: string;
  endDate: string;
  topicSource: CalendarTopicSource;
  userTopics: string;
  keywordClusterId: string;
  planningData?: ProjectPlanningData;
}): boolean {
  if (input.seoProjectId.trim() === "") return false;
  if (input.name.trim() === "") return false;
  if (!checkDateRange(input.startDate, input.endDate).ok) return false;

  if (input.topicSource === "USER_TOPICS") return input.userTopics.trim().length > 0;
  if (input.topicSource === "TOPIC_CLUSTER") return input.keywordClusterId.trim().length > 0;
  // Planning from project data needs the project to actually have some.
  const data = input.planningData;
  return Boolean(data && (data.keywordCount > 0 || data.contentCount > 0));
}

/** Builds the exact request the action expects; blank optional fields become undefined. */
export function buildCalendarRequest(form: {
  seoProjectId: string;
  name: string;
  startDate: string;
  endDate: string;
  cadence: CalendarCadence;
  topicSource: CalendarTopicSource;
  userTopics: string;
  keywordClusterId: string;
  audience: string;
  notes: string;
}): ContentCalendarInput {
  return {
    seoProjectId: form.seoProjectId,
    name: form.name.trim(),
    startDate: form.startDate,
    endDate: form.endDate,
    cadence: form.cadence,
    topicSource: form.topicSource,
    userTopics: form.topicSource === "USER_TOPICS" ? form.userTopics.trim() : undefined,
    keywordClusterId: form.topicSource === "TOPIC_CLUSTER" ? form.keywordClusterId || undefined : undefined,
    audience: form.audience.trim() || undefined,
    notes: form.notes.trim() || undefined,
  };
}

/**
 * The fourteenth AI Workspace tool's UI. Reuses the exact job→poll→stream
 * lifecycle every other picker uses, then hands the proposal to
 * ContentCalendarReview — where the user edits it before anything is saved.
 */
export default function ContentCalendarPicker({ seoProjectOptions, planningDataByProject }: ContentCalendarPickerProps) {
  const router = useRouter();

  // Deliberately unselected — auto-selecting the first project would let a
  // user plan against one they never consciously chose. The server re-derives
  // and enforces ownership regardless of this value.
  const [seoProjectId, setSeoProjectId] = useState("");
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [cadence, setCadence] = useState<CalendarCadence>("WEEKLY");
  const [topicSource, setTopicSource] = useState<CalendarTopicSource>("PROJECT_DATA");
  const [userTopics, setUserTopics] = useState("");
  const [keywordClusterId, setKeywordClusterId] = useState("");
  const [audience, setAudience] = useState("");
  const [notes, setNotes] = useState("");

  const [result, setResult] = useState<ContentCalendarResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<LlmErrorType | null>(null);

  const planningData = seoProjectId ? planningDataByProject[seoProjectId] : undefined;
  const clusters = planningData?.clusters ?? [];
  const rangeCheck = startDate && endDate ? checkDateRange(startDate, endDate) : null;

  function applyResult(resultJson: unknown) {
    const parsed = contentCalendarJobResultSchema.safeParse(resultJson);
    if (!parsed.success) {
      setErrorType(null);
      setError("Received an unexpected result — please try generating again.");
      return;
    }
    setResult(parsed.data.result);
  }

  const lifecycle = useAiGenerationLifecycle(resumeJob);

  /** Reattaches to the job named in ?jobId=, whatever its status — same shape as every other picker's resumeJob. */
  async function resumeJob(jobId: string) {
    const poll = await getAiGenerationJobAction(jobId);
    if (!poll.success || !poll.data || poll.data.taskType !== "CONTENT_CALENDAR") {
      lifecycle.setActiveJob(null);
      return;
    }
    const job = poll.data;
    const parsedInput = contentCalendarInputSchema.safeParse(job.inputJson);
    if (!parsedInput.success) {
      lifecycle.setActiveJob(null);
      return;
    }
    setSeoProjectId(parsedInput.data.seoProjectId);
    setName(parsedInput.data.name);
    setStartDate(parsedInput.data.startDate);
    setEndDate(parsedInput.data.endDate);
    setCadence(parsedInput.data.cadence);
    setTopicSource(parsedInput.data.topicSource);
    setUserTopics(parsedInput.data.userTopics ?? "");
    setKeywordClusterId(parsedInput.data.keywordClusterId ?? "");
    setAudience(parsedInput.data.audience ?? "");
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

  function handleProjectChange(value: string) {
    setSeoProjectId(value);
    // A cluster from the previous project must never survive a project change.
    setKeywordClusterId("");
    setResult(null);
  }

  const canGenerate = computeCanGenerateCalendar({ seoProjectId, name, startDate, endDate, topicSource, userTopics, keywordClusterId, planningData });

  async function runGenerate() {
    if (!canGenerate) return;
    setError(null);
    setErrorType(null);
    setResult(null);
    setIsGenerating(true);
    const response = await startContentCalendarAction(
      buildCalendarRequest({ seoProjectId, name, startDate, endDate, cadence, topicSource, userTopics, keywordClusterId, audience, notes })
    );

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

  /** The explicit approval step — the only thing in this tool that writes to the database. */
  async function handleSave(entries: ProposedCalendarEntry[]) {
    if (!result) return;
    setIsSaving(true);
    setError(null);
    const response = await saveContentCalendarAction({
      seoProjectId,
      name: name.trim(),
      startDate: result.startDate,
      endDate: result.endDate,
      keywordClusterId: topicSource === "TOPIC_CLUSTER" && keywordClusterId ? keywordClusterId : null,
      notes: notes.trim() || undefined,
      entries: entries.map((entry) => ({
        scheduledDate: entry.scheduledDate,
        topic: entry.topic,
        contentType: entry.contentType,
        role: entry.role,
        status: "PLANNED" as const,
        keywordId: entry.keywordId,
        notes: entry.notes || undefined,
      })),
    });
    setIsSaving(false);

    if (!response.success) {
      setError(response.message);
      return;
    }
    toast.success("Content calendar saved");
    router.push(`/ai/content-calendar/${response.data.id}`);
  }

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
        <label htmlFor="calendarName" className="text-sm font-medium">
          Calendar name <span className="text-red-500">*</span>
        </label>
        <Input id="calendarName" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="e.g. Q4 self storage content plan" />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label htmlFor="startDate" className="text-sm font-medium">
            Start date <span className="text-red-500">*</span>
          </label>
          <Input id="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label htmlFor="endDate" className="text-sm font-medium">
            End date <span className="text-red-500">*</span>
          </label>
          <Input id="endDate" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>
      {rangeCheck && !rangeCheck.ok && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-700">{rangeCheck.message}</p>}
      {rangeCheck && rangeCheck.ok && <p className="text-xs text-slate-500">{rangeCheck.days} days.</p>}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="cadence" className="text-sm font-medium">
          How often to publish
        </label>
        <select id="cadence" className={selectClassName} value={cadence} onChange={(e) => setCadence(e.target.value as CalendarCadence)}>
          {CALENDAR_CADENCES.map((value) => (
            <option key={value} value={value}>
              {CADENCE_LABELS[value]}
            </option>
          ))}
        </select>
        <p className="text-xs text-slate-500">Compass works out the actual dates from your range and this rhythm — the AI never picks a date.</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="topicSource" className="text-sm font-medium">
          Where should the topics come from?
        </label>
        <select id="topicSource" className={selectClassName} value={topicSource} onChange={(e) => setTopicSource(e.target.value as CalendarTopicSource)}>
          <option value="PROJECT_DATA">{TOPIC_SOURCE_LABELS.PROJECT_DATA}</option>
          <option value="TOPIC_CLUSTER">{TOPIC_SOURCE_LABELS.TOPIC_CLUSTER}</option>
          <option value="USER_TOPICS">{TOPIC_SOURCE_LABELS.USER_TOPICS}</option>
        </select>
        {seoProjectId && planningData && (
          <p className="text-xs text-slate-500">
            This project has {planningData.keywordCount} keyword{planningData.keywordCount === 1 ? "" : "s"}, {planningData.contentCount} page
            {planningData.contentCount === 1 ? "" : "s"} and {clusters.length} topic cluster{clusters.length === 1 ? "" : "s"}.
          </p>
        )}
      </div>

      {topicSource === "TOPIC_CLUSTER" && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="keywordClusterId" className="text-sm font-medium">
            Topic cluster <span className="text-red-500">*</span>
          </label>
          <select id="keywordClusterId" className={selectClassName} value={keywordClusterId} onChange={(e) => setKeywordClusterId(e.target.value)} disabled={clusters.length === 0}>
            <option value="">{clusters.length > 0 ? "Select a cluster…" : "This project has no clusters yet…"}</option>
            {clusters.map((cluster) => (
              <option key={cluster.id} value={cluster.id}>
                {cluster.name} ({cluster.keywordCount} keyword{cluster.keywordCount === 1 ? "" : "s"})
              </option>
            ))}
          </select>
          {clusters.length === 0 && (
            <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              This project has no topic clusters yet. Use the Topic Cluster Planner to build one, or choose another topic source.
            </p>
          )}
        </div>
      )}

      {topicSource === "USER_TOPICS" && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="userTopics" className="text-sm font-medium">
            Your topics <span className="text-red-500">*</span>
          </label>
          <p className="text-xs text-slate-500">One topic per line. These are the plan — the AI orders them rather than replacing them.</p>
          <textarea id="userTopics" className={textareaClassName} value={userTopics} onChange={(e) => setUserTopics(e.target.value)} maxLength={4000} />
        </div>
      )}

      {topicSource === "PROJECT_DATA" && seoProjectId && planningData && planningData.keywordCount === 0 && planningData.contentCount === 0 && (
        <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-700">
          This project has no keywords or pages yet, so there is nothing to plan from. Add keywords, or choose &quot;Topics I type myself&quot;.
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="audience" className="text-sm font-medium">
          Audience (optional)
        </label>
        <Input id="audience" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="e.g. First-time self storage investors" />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="notes" className="text-sm font-medium">
          Notes (optional)
        </label>
        <textarea id="notes" className={textareaClassName} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <AiGenerationError error={error} errorType={errorType} />

      <AiGenerationStatusNote isSwitchingProvider={lifecycle.isSwitchingProvider} />
      {isGenerating && !lifecycle.isSwitchingProvider && lifecycle.streamProgress !== null && <Progress value={lifecycle.streamProgress} aria-label="Generation progress" />}

      <div className="flex gap-2">
        <Button type="button" onClick={runGenerate} disabled={isGenerating || isSaving || !canGenerate}>
          {isGenerating ? "Generating..." : "Generate schedule"}
        </Button>
        {isGenerating && (
          <Button type="button" variant="outline" onClick={() => lifecycle.cancel(() => setIsGenerating(false))}>
            Cancel
          </Button>
        )}
      </div>

      {result === null && !isGenerating && lifecycle.activeJobId && !error && (
        <p className="text-sm text-slate-500">No usable schedule came back this time — please try generating again.</p>
      )}

      {result && <ContentCalendarReview result={result} isSaving={isSaving} onSave={handleSave} />}
    </div>
  );
}
