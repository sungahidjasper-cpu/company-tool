"use client";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { EmailNewsletterResult } from "@/features/ai-workspace/schemas/email-newsletter.schema";

/**
 * Plain-text formatting of the structured draft for the clipboard — the same
 * role formatPressReleaseAsText plays for Press Release Generator. Plain,
 * readable text with blank-line separation, not Markdown: a newsletter has no
 * Markdown structure rendered anywhere in this tool.
 *
 * Subject and preview text are labelled rather than run together with the
 * body, because they are inbox metadata rather than email copy — pasting them
 * unlabelled into an email builder's body field would be the wrong outcome.
 * Never includes `reasoning`, which is a note to the reviewer and not part of
 * the newsletter.
 */
export function formatNewsletterAsText(result: EmailNewsletterResult): string {
  const parts: string[] = [`Subject: ${result.subjectLine}`, `Preview text: ${result.previewText}`, "", result.headline, result.introduction];

  for (const section of result.bodySections) {
    parts.push("", section.heading, section.body);
  }
  if (result.callToAction.trim()) parts.push("", result.callToAction);
  if (result.closing.trim()) parts.push("", result.closing);

  return parts.join("\n").trim();
}

type EmailNewsletterReviewProps = {
  result: EmailNewsletterResult;
  /** Present once a job exists to save — absent while resuming a job whose id isn't known yet. */
  onSave?: () => void;
  isSaving?: boolean;
};

/**
 * The dedicated review component — read-only display of the drafted
 * newsletter, a copy-to-clipboard action, and an explicit "Save as Content"
 * action. Nothing here is ever sent automatically: no email is dispatched,
 * no schedule or recipient control exists, and saving only ever happens on
 * the reviewer's own click of the button below — never merely because
 * generation finished.
 *
 * The "Draft only — nothing is sent automatically" badge is load-bearing
 * rather than decorative: the single most damaging misunderstanding this
 * screen could create is a user believing an email has gone out.
 */
export default function EmailNewsletterReview({ result, onSave, isSaving = false }: EmailNewsletterReviewProps) {
  async function handleCopy() {
    await navigator.clipboard.writeText(formatNewsletterAsText(result));
    toast.success("Copied newsletter to clipboard");
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-slate-800">Newsletter draft</p>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500">
          Draft only — nothing is sent automatically
        </span>
      </div>

      <div className="flex flex-col gap-2 rounded-lg bg-slate-50 p-3">
        <div className="flex flex-col gap-0.5">
          <p className="text-xs font-medium tracking-wide text-slate-400 uppercase">Subject line</p>
          <p className="text-sm font-medium break-words text-slate-800">{result.subjectLine}</p>
        </div>
        <div className="flex flex-col gap-0.5">
          <p className="text-xs font-medium tracking-wide text-slate-400 uppercase">Preview text</p>
          <p className="text-sm break-words text-slate-600">{result.previewText}</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 text-sm text-slate-800">
        <h2 className="text-lg font-bold break-words text-slate-900">{result.headline}</h2>
        <p className="break-words">{result.introduction}</p>

        {result.bodySections.map((section, index) => (
          <div key={`${section.heading}-${index}`} className="flex flex-col gap-1">
            <h3 className="font-semibold break-words text-slate-900">{section.heading}</h3>
            <p className="break-words">{section.body}</p>
          </div>
        ))}

        {result.callToAction.trim() && <p className="font-medium break-words">{result.callToAction}</p>}
        {result.closing.trim() && <p className="break-words text-slate-600">{result.closing}</p>}
      </div>

      <div className="rounded-lg bg-slate-50 p-3">
        <p className="text-xs font-medium tracking-wide text-slate-400 uppercase">Notes</p>
        <p className="text-sm text-slate-600">{result.reasoning}</p>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={handleCopy}>
          Copy newsletter
        </Button>
        {onSave && (
          <Button type="button" size="sm" onClick={onSave} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save as Content"}
          </Button>
        )}
      </div>
    </div>
  );
}
