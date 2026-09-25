"use client";

import { CalendarClock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cancelContentScheduleAction, scheduleContentAction } from "@/features/content-workspace/actions/content-scheduling.actions";
import { browserTimeZone, timeZoneOptions } from "@/features/content-workspace/services/timezone-options";

const fieldClassName =
  "h-9 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

/**
 * Phase 5 — the authoritative control for a Content record's schedule.
 *
 * The Content Detail page owns scheduling state, so this is the one place it
 * is changed. Nothing here writes until Schedule or Cancel schedule is
 * pressed: typing a date, picking a time and choosing a zone are all local
 * state.
 *
 * The server re-validates everything this component checks, and owns the
 * decisions this component cannot make — ownership, soft-delete state, and
 * whether the instant is genuinely in the future at the moment of the write.
 */
export default function ContentSchedulePanel({
  contentId,
  state,
  initialDateIso,
  initialTime,
  initialTimeZone,
  canSchedule,
  disabledReason,
}: {
  contentId: string;
  /** The resolved, human-readable current state, rendered above the form. */
  state: { kind: "PUBLISHED" | "SCHEDULED" | "UNSCHEDULED"; label: string; detail: string };
  initialDateIso: string;
  initialTime: string;
  initialTimeZone: string | null;
  canSchedule: boolean;
  disabledReason: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dateIso, setDateIso] = useState(initialDateIso);
  const [time, setTime] = useState(initialTime);
  // Falls back to the reader's own zone rather than assuming a company one.
  const [timeZone, setTimeZone] = useState(initialTimeZone ?? browserTimeZone());
  const [error, setError] = useState<string | null>(null);

  const zones = timeZoneOptions(timeZone);

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await scheduleContentAction({ contentId, dateIso, time, timeZone });
      if (!result.success) {
        setError(result.message);
        return;
      }
      toast.success(`Scheduled for ${result.data?.scheduledFor ?? "the chosen time"}`);
      router.refresh();
    });
  }

  function cancel() {
    setError(null);
    startTransition(async () => {
      const result = await cancelContentScheduleAction({ contentId });
      if (!result.success) {
        setError(result.message);
        return;
      }
      toast.success("Schedule cancelled — this content is back to draft.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2">
        <CalendarClock size={16} className="mt-0.5 shrink-0 text-slate-500" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800">{state.label}</p>
          <p className="text-sm text-slate-600">{state.detail}</p>
        </div>
      </div>

      {!canSchedule ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600">{disabledReason}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Date</span>
              <input type="date" className={fieldClassName} value={dateIso} onChange={(e) => setDateIso(e.target.value)} disabled={isPending} />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Time</span>
              <input type="time" className={fieldClassName} value={time} onChange={(e) => setTime(e.target.value)} disabled={isPending} />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Timezone</span>
              <select className={fieldClassName} value={timeZone} onChange={(e) => setTimeZone(e.target.value)} disabled={isPending}>
                {zones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="text-xs leading-snug text-slate-500">
            The time is stored exactly as you choose it here, together with the timezone, so it always reads back as the same local moment.
            Scheduling records an intention — it does not publish the content.
          </p>

          {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={submit} disabled={isPending}>
              {isPending ? "Saving…" : state.kind === "SCHEDULED" ? "Update schedule" : "Schedule"}
            </Button>
            {state.kind === "SCHEDULED" && (
              <Button type="button" variant="outline" onClick={cancel} disabled={isPending}>
                Cancel schedule
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
