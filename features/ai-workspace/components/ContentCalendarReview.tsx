"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CADENCE_LABELS,
  CALENDAR_CONTENT_TYPES,
  CALENDAR_ENTRY_ROLES,
  checkDateRange,
  parseIsoDate,
  isWithinRange,
  type ContentCalendarResult,
  type ProposedCalendarEntry,
} from "@/features/ai-workspace/schemas/content-calendar.schema";

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export const CONTENT_TYPE_LABELS: Record<string, string> = {
  ARTICLE: "Article",
  GUIDE: "Guide",
  LANDING_PAGE: "Landing page",
  FAQ_PAGE: "FAQ page",
  CASE_STUDY: "Case study",
  COMPARISON: "Comparison",
  OTHER: "Other",
};

export const ROLE_LABELS: Record<string, string> = {
  PILLAR: "Pillar",
  SUPPORTING: "Supporting",
  RELATED: "Related",
};

/** Badge styling per role, so a pillar is visually distinct from its supporting pieces. */
const ROLE_BADGE: Record<string, string> = {
  PILLAR: "bg-slate-800 text-white",
  SUPPORTING: "bg-slate-200 text-slate-700",
  RELATED: "bg-slate-100 text-slate-600",
};

/**
 * Validates the edited schedule before the save button is offered — the same
 * rules the server enforces, so a plan that looks saveable is saveable.
 *
 * Returns a message per entry index, plus a calendar-level message. Pure and
 * directly unit-testable.
 */
export function validateEditedEntries(
  entries: readonly ProposedCalendarEntry[],
  startDate: string,
  endDate: string
): { entryErrors: Record<number, string>; formError: string | null } {
  const entryErrors: Record<number, string> = {};

  if (entries.length === 0) return { entryErrors, formError: "A calendar needs at least one entry." };

  const range = checkDateRange(startDate, endDate);
  if (!range.ok) return { entryErrors, formError: range.message };

  const seenTopics = new Map<string, number>();

  entries.forEach((entry, index) => {
    if (entry.topic.trim() === "") {
      entryErrors[index] = "Every entry needs a topic.";
      return;
    }
    const date = parseIsoDate(entry.scheduledDate);
    if (!date) {
      entryErrors[index] = "That is not a real date.";
      return;
    }
    if (!isWithinRange(date, range.range)) {
      entryErrors[index] = "That date is outside the calendar's range.";
      return;
    }
    const key = entry.topic.trim().toLowerCase().replace(/\s+/g, " ");
    const firstAt = seenTopics.get(key);
    if (firstAt !== undefined) {
      entryErrors[index] = "This topic is already on the calendar.";
      return;
    }
    seenTopics.set(key, index);
  });

  return { entryErrors, formError: null };
}

/** Plain-text export of the reviewed schedule, for pasting into a doc or a ticket. */
export function formatCalendarAsText(result: ContentCalendarResult, entries: readonly ProposedCalendarEntry[]): string {
  const lines: string[] = [result.name, `${result.startDate} to ${result.endDate} · ${CADENCE_LABELS[result.cadence]}`, ""];

  for (const entry of entries) {
    lines.push(`${entry.scheduledDate}  [${ROLE_LABELS[entry.role]}] ${entry.topic}`);
    lines.push(`  Type: ${CONTENT_TYPE_LABELS[entry.contentType]}`);
    if (entry.keywordTerm) lines.push(`  Target keyword: ${entry.keywordTerm}`);
    if (entry.notes) lines.push(`  Notes: ${entry.notes}`);
    if (entry.overlapNote) lines.push(`  Check: ${entry.overlapNote}`);
    if (entry.existingContentTitle) lines.push(`  Possible existing page: "${entry.existingContentTitle}" (title match only)`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

type ContentCalendarReviewProps = {
  result: ContentCalendarResult;
  isSaving: boolean;
  onSave: (entries: ProposedCalendarEntry[]) => void;
};

/**
 * The review-and-edit step. Every proposed entry is editable here, and nothing
 * is written until the user presses Save — which is what makes the AI a
 * suggestion rather than an author of database rows.
 */
export default function ContentCalendarReview({ result, isSaving, onSave }: ContentCalendarReviewProps) {
  const [entries, setEntries] = useState<ProposedCalendarEntry[]>(result.entries);

  const { entryErrors, formError } = validateEditedEntries(entries, result.startDate, result.endDate);
  const hasErrors = formError !== null || Object.keys(entryErrors).length > 0;

  function updateEntry(index: number, patch: Partial<ProposedCalendarEntry>) {
    setEntries((current) => current.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
  }

  function removeEntry(index: number) {
    setEntries((current) => current.filter((_, i) => i !== index));
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(formatCalendarAsText(result, entries));
    toast.success("Copied schedule to clipboard");
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold text-slate-800">{result.name}</p>
          <p className="text-xs text-slate-500">
            {result.startDate} to {result.endDate} · {CADENCE_LABELS[result.cadence]} · {entries.length} entr{entries.length === 1 ? "y" : "ies"}
          </p>
        </div>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500">Not saved yet — review and edit first</span>
      </div>

      {result.droppedForLackOfSlots > 0 && (
        <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          {result.droppedForLackOfSlots} further idea{result.droppedForLackOfSlots === 1 ? "" : "s"} had no publishing date left in this range. Extend the range or publish
          more often to fit {result.droppedForLackOfSlots === 1 ? "it" : "them"} in.
        </p>
      )}

      <div className="flex flex-col gap-3">
        {entries.map((entry, index) => (
          <div key={`${entry.topic}-${index}`} className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3">
            <div className="flex flex-wrap items-start gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ROLE_BADGE[entry.role]}`}>{ROLE_LABELS[entry.role]}</span>
              {entry.keywordTerm && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{entry.keywordTerm}</span>}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="flex w-full flex-col gap-1 sm:w-40">
                <label htmlFor={`entry-date-${index}`} className="text-xs font-medium text-slate-600">
                  Date
                </label>
                <Input
                  id={`entry-date-${index}`}
                  type="date"
                  value={entry.scheduledDate}
                  min={result.startDate}
                  max={result.endDate}
                  onChange={(e) => updateEntry(index, { scheduledDate: e.target.value })}
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <label htmlFor={`entry-topic-${index}`} className="text-xs font-medium text-slate-600">
                  Topic
                </label>
                <Input id={`entry-topic-${index}`} value={entry.topic} onChange={(e) => updateEntry(index, { topic: e.target.value })} maxLength={300} />
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <label htmlFor={`entry-type-${index}`} className="text-xs font-medium text-slate-600">
                  Content type
                </label>
                <select id={`entry-type-${index}`} className={selectClassName} value={entry.contentType} onChange={(e) => updateEntry(index, { contentType: e.target.value as ProposedCalendarEntry["contentType"] })}>
                  {CALENDAR_CONTENT_TYPES.map((value) => (
                    <option key={value} value={value}>
                      {CONTENT_TYPE_LABELS[value]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <label htmlFor={`entry-role-${index}`} className="text-xs font-medium text-slate-600">
                  Role
                </label>
                <select id={`entry-role-${index}`} className={selectClassName} value={entry.role} onChange={(e) => updateEntry(index, { role: e.target.value as ProposedCalendarEntry["role"] })}>
                  {CALENDAR_ENTRY_ROLES.map((value) => (
                    <option key={value} value={value}>
                      {ROLE_LABELS[value]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {entry.notes && <p className="text-xs text-slate-500">{entry.notes}</p>}

            {/*
              Overlap is FLAGGED, never removed. The user decides whether two
              close topics should be merged — the system only points it out.
            */}
            {entry.overlapNote && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-700">Check for overlap: {entry.overlapNote}</p>}
            {entry.existingContentTitle && (
              <p className="text-xs text-amber-600">
                You may already have a page like this: &quot;{entry.existingContentTitle}&quot; — a title match only, not a full comparison.
              </p>
            )}

            {entryErrors[index] && <p className="text-xs font-medium text-red-600">{entryErrors[index]}</p>}

            <div className="flex justify-end">
              <Button type="button" size="sm" variant="outline" onClick={() => removeEntry(index)} aria-label={`Remove entry ${index + 1}`}>
                Remove
              </Button>
            </div>
          </div>
        ))}
      </div>

      {formError && <p className="text-sm font-medium text-red-600">{formError}</p>}

      <p className="text-xs text-slate-400">
        The schedule above is a recommendation. Compass has no ranking, traffic or search-volume data for any page, so none is shown, and publishing on a date does not
        guarantee any result.
      </p>

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={handleCopy}>
          Copy schedule
        </Button>
        <Button type="button" size="sm" onClick={() => onSave(entries)} disabled={isSaving || hasErrors}>
          {isSaving ? "Saving..." : "Save calendar"}
        </Button>
      </div>
    </div>
  );
}
