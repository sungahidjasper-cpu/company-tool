"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { deleteContentCalendarAction, updateCalendarEntryStatusAction } from "@/features/ai-workspace/actions/content-calendar.actions";
import { buildBriefHandoffHref } from "@/features/ai-workspace/services/content-gap-to-brief";
import { buildCalendarEntryBriefHandoff } from "@/features/ai-workspace/services/calendar-entry-to-brief";
import { CONTENT_TYPE_LABELS, ROLE_LABELS } from "@/features/ai-workspace/components/ContentCalendarReview";
import { CALENDAR_ENTRY_STATUSES, type CalendarEntryStatusValue } from "@/features/ai-workspace/schemas/content-calendar.schema";

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-44";

export const STATUS_LABELS: Record<CalendarEntryStatusValue, string> = {
  PLANNED: "Planned",
  BRIEF_CREATED: "Brief created",
  DRAFT: "Draft",
  IN_PROGRESS: "In progress",
  PUBLISHED: "Published",
  COMPLETED: "Completed",
};

const ROLE_BADGE: Record<string, string> = {
  PILLAR: "bg-slate-800 text-white",
  SUPPORTING: "bg-slate-200 text-slate-700",
  RELATED: "bg-slate-100 text-slate-600",
};

export type SavedCalendarEntry = {
  id: string;
  scheduledDate: string;
  topic: string;
  contentType: string;
  role: string;
  status: CalendarEntryStatusValue;
  notes: string | null;
  keywordTerm: string | null;
  contentId: string | null;
  contentTitle: string | null;
};

type SavedCalendarViewProps = {
  calendarId: string;
  seoProjectId: string;
  entries: SavedCalendarEntry[];
};

/**
 * A saved calendar's entry list.
 *
 * Each entry can move status and can hand off into the existing Content Brief
 * workflow. Both are explicit user actions: opening the hand-off creates
 * nothing, and a status only ever changes because someone chose it — never
 * because a date passed.
 */
export default function SavedCalendarView({ calendarId, seoProjectId, entries }: SavedCalendarViewProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function changeStatus(entryId: string, status: CalendarEntryStatusValue) {
    startTransition(async () => {
      const response = await updateCalendarEntryStatusAction({ calendarId, entryId, status });
      if (!response.success) {
        toast.error(response.message);
        return;
      }
      toast.success("Status updated");
      router.refresh();
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const response = await deleteContentCalendarAction(calendarId);
      if (!response.success) {
        toast.error(response.message);
        return;
      }
      toast.success("Calendar deleted");
      router.push("/ai/content-calendar");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-3">
        {entries.map((entry) => {
          const handoff = buildCalendarEntryBriefHandoff(seoProjectId, entry);
          return (
            <li key={entry.id} className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium tracking-wide text-slate-400 uppercase">{entry.scheduledDate}</p>
                  <p className="font-medium break-words text-slate-800">{entry.topic}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ROLE_BADGE[entry.role] ?? ROLE_BADGE.RELATED}`}>
                    {ROLE_LABELS[entry.role] ?? entry.role}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                    {CONTENT_TYPE_LABELS[entry.contentType] ?? entry.contentType}
                  </span>
                </div>
              </div>

              {entry.keywordTerm && <p className="text-xs text-slate-500">Target keyword: {entry.keywordTerm}</p>}
              {entry.notes && <p className="text-sm text-slate-600">{entry.notes}</p>}

              {entry.contentId && entry.contentTitle && (
                <p className="text-xs text-slate-500">
                  Linked page:{" "}
                  <Link href={`/seo/${seoProjectId}/content/${entry.contentId}`} className="font-medium text-primary hover:underline">
                    {entry.contentTitle}
                  </Link>
                </p>
              )}

              <div className="flex flex-wrap items-end justify-between gap-2">
                <div className="flex flex-col gap-1">
                  <label htmlFor={`status-${entry.id}`} className="text-xs font-medium text-slate-600">
                    Status
                  </label>
                  <select
                    id={`status-${entry.id}`}
                    className={selectClassName}
                    value={entry.status}
                    disabled={isPending}
                    onChange={(e) => changeStatus(entry.id, e.target.value as CalendarEntryStatusValue)}
                  >
                    {CALENDAR_ENTRY_STATUSES.map((value) => (
                      <option key={value} value={value}>
                        {STATUS_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </div>

                {/*
                  Hand-off into the EXISTING Content Brief workflow. Opening it
                  only prefills a form — no Content row is created here or there.
                */}
                {handoff && (
                  <Link href={buildBriefHandoffHref(handoff)} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                    <Sparkles size={16} /> Create Content Brief
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-slate-400">
        Changing a status here records where the plan has got to. It never edits the page itself, and nothing is marked published just because its date has passed.
      </p>

      <div className="flex justify-end gap-2">
        {confirmingDelete ? (
          <>
            <Button type="button" size="sm" variant="outline" onClick={() => setConfirmingDelete(false)} disabled={isPending}>
              Keep calendar
            </Button>
            <Button type="button" size="sm" variant="destructive" onClick={handleDelete} disabled={isPending}>
              {isPending ? "Deleting..." : "Yes, delete it"}
            </Button>
          </>
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={() => setConfirmingDelete(true)} disabled={isPending}>
            Delete calendar
          </Button>
        )}
      </div>
    </div>
  );
}
