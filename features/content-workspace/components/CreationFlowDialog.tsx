"use client";

import { CalendarClock, FileText, Search, Share2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { formatScheduledFor, zonedWallTimeToInstant } from "@/features/content-workspace/services/content-scheduling";
import { browserTimeZone, timeZoneOptions } from "@/features/content-workspace/services/timezone-options";

const fieldClassName =
  "h-9 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

export type CreationProject = { id: string; name: string };

/**
 * Phase 5 — the calendar's creation workflow: date and time, then what to
 * create.
 *
 * Two steps, and NEITHER writes anything. Choosing a date, a time, a zone or
 * a content type only decides where the user is sent next; the record and its
 * schedule are created by one explicit Save on the form this hands off to.
 * Cancelling at any point leaves the database exactly as it was.
 *
 * The date the user clicked is the date this opens on — it is never quietly
 * replaced with today.
 */
export default function CreationFlowDialog({
  open,
  dateIso,
  projects,
  selectedProjectId,
  clientId,
  onClose,
}: {
  open: boolean;
  /** The day the user clicked, as YYYY-MM-DD. */
  dateIso: string;
  /** Projects the actor may create content in, within the current context. */
  projects: CreationProject[];
  /** The project already chosen in the workspace context, if any. */
  selectedProjectId: string;
  clientId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  /** Content belongs to a client, so a concrete one must be chosen — "all clients" is not an owner. */
  const canCreateForClient = clientId !== "" && clientId !== "all" && clientId !== "unassigned";
  const [step, setStep] = useState<"WHEN" | "WHAT">("WHEN");
  const [date, setDate] = useState(dateIso);
  const [time, setTime] = useState("09:00");
  const [timeZone, setTimeZone] = useState(browserTimeZone());
  const [projectId, setProjectId] = useState(selectedProjectId || projects[0]?.id || "");
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  /*
   * There is deliberately no effect resetting this state when the day
   * changes. The parent gives this component a key derived from the open
   * flag and the selected day, so opening it on a different date remounts it
   * with the right initial state — which is both simpler than a reset effect
   * and free of the cascading render one causes.
   */

  // Escape closes, and focus moves into the panel so the flow is keyboard-usable.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const instant = zonedWallTimeToInstant(date, time, timeZone);
  const readable = instant ? formatScheduledFor(instant, timeZone) : null;

  function toWhat() {
    if (!instant) {
      setError("Choose a valid date, time and timezone.");
      return;
    }
    if (instant.getTime() <= Date.now()) {
      setError("Choose a time in the future — content cannot be scheduled in the past.");
      return;
    }
    setError(null);
    setStep("WHAT");
  }

  function createBlogPost() {
    /*
     * No project is required. An article belongs to the client; the project
     * only supplies keywords and a domain, and the studio says so when there
     * is none. Requiring one here was the last place the old model leaked.
     */
    if (!canCreateForClient) {
      setError("Choose a client first — content belongs to a client.");
      return;
    }
    /*
     * Phase 7 — the Blog Studio, not the generic content form. The plain form
     * at /seo/[id]/content/new still exists and still works for anyone who
     * wants a bare record; this route is for writing the article.
     */
    const params = new URLSearchParams({ date, time, tz: timeZone, client: clientId });
    if (projectId) params.set("project", projectId);
    router.push(`/content/create/blog?${params.toString()}`);
  }

  /**
   * SEO content, routed to the SEO project's OWN existing content form.
   *
   * This is the one type that genuinely needs a project: the form lives under
   * the project, and the record joins that project's page inventory. So the
   * option appears only when the client has a project to put it in — offering
   * it otherwise would be a button that cannot work.
   */
  function createSeoContent() {
    if (!canCreateForClient) {
      setError("Choose a client first — content belongs to a client.");
      return;
    }
    if (!projectId) {
      setError("Choose which SEO project this content belongs to.");
      return;
    }
    router.push(`/seo/${projectId}/content/new`);
  }

  function createSocialPost() {
    if (!canCreateForClient) {
      setError("Choose a client first — a social post is written for a client's accounts.");
      return;
    }
    const params = new URLSearchParams({ date, time, tz: timeZone, client: clientId });
    if (projectId) params.set("project", projectId);
    router.push(`/content/create/social?${params.toString()}`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/30 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Create content">
      <div
        ref={panelRef}
        tabIndex={-1}
        className="flex max-h-[90vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-t-xl bg-white p-5 shadow-xl outline-none sm:rounded-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
              {step === "WHEN" ? "Step 1 of 2" : "Step 2 of 2"}
            </p>
            <h2 className="text-lg font-semibold text-slate-900">{step === "WHEN" ? "Select date & time" : "What would you like to create?"}</h2>
          </div>
          <Button type="button" variant="outline" size="icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </Button>
        </div>

        {/* The chosen moment stays visible through both steps. */}
        {readable && (
          <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
            <CalendarClock size={15} className="mt-0.5 shrink-0 text-slate-500" />
            <p className="text-sm text-slate-700">{readable}</p>
          </div>
        )}

        {step === "WHEN" ? (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="flex min-w-0 flex-col gap-1.5">
                <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Date</span>
                <input type="date" className={fieldClassName} value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <label className="flex min-w-0 flex-col gap-1.5">
                <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Time</span>
                <input type="time" className={fieldClassName} value={time} onChange={(e) => setTime(e.target.value)} />
              </label>
              <label className="flex min-w-0 flex-col gap-1.5">
                <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Timezone</span>
                <select className={fieldClassName} value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
                  {timeZoneOptions(timeZone).map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <p className="text-xs leading-snug text-slate-500">
              Nothing is created or scheduled by choosing a time. This only decides when the content you create next is intended to publish.
            </p>

            {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="button" onClick={toWhat}>
                Continue
              </Button>
            </div>
          </>
        ) : (
          <>
            {projects.length > 1 && (
              <label className="flex min-w-0 flex-col gap-1.5">
                <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">SEO project</span>
                <select className={fieldClassName} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <button
                type="button"
                onClick={createSocialPost}
                className="flex min-w-0 flex-col gap-1 rounded-lg border border-slate-200 p-3 text-left transition-colors hover:border-slate-300 hover:bg-slate-50"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Share2 size={15} className="shrink-0 text-slate-600" /> Social media
                </span>
                <span className="text-xs leading-snug text-slate-500">
                  One post for the client&apos;s social accounts, with a caption per platform. No SEO project needed.
                </span>
              </button>

              <button
                type="button"
                onClick={createBlogPost}
                className="flex min-w-0 flex-col gap-1 rounded-lg border border-slate-200 p-3 text-left transition-colors hover:border-slate-300 hover:bg-slate-50"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <FileText size={15} className="shrink-0 text-slate-600" /> Blog post
                </span>
                <span className="text-xs leading-snug text-slate-500">
                  A publishable website article, saved as this client&apos;s content and scheduled for the time above. No SEO project needed.
                </span>
              </button>

              {projects.length > 0 && (
                <button
                  type="button"
                  onClick={createSeoContent}
                  className="flex min-w-0 flex-col gap-1 rounded-lg border border-slate-200 p-3 text-left transition-colors hover:border-slate-300 hover:bg-slate-50"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Search size={15} className="shrink-0 text-slate-600" /> SEO content
                  </span>
                  <span className="text-xs leading-snug text-slate-500">
                    A page in the SEO project&apos;s own content list, for keyword-driven work. Opens the project&apos;s existing content form.
                  </span>
                </button>
              )}
            </div>

            {!canCreateForClient ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Choose a specific client above before creating content — content belongs to a client.
              </p>
            ) : (
              projects.length === 0 && (
                <p className="text-xs leading-snug text-slate-500">
                  This client has no SEO project. Social and blog content do not need one; keyword-driven SEO content does.
                </p>
              )
            )}

            {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

            <div className="flex flex-wrap justify-between gap-2">
              <Button type="button" variant="outline" onClick={() => setStep("WHEN")}>
                Back
              </Button>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
