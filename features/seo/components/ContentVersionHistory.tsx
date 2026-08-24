"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { restoreContentRevisionAction } from "@/features/seo/actions/content-revision.actions";
import type { ContentRevisionSummary } from "@/features/seo/services/content-revision.service";

/**
 * Phase 25 Stage 4 — the Version History card. Deliberately thin: all
 * authorization, tenant isolation, snapshot-before-overwrite, and
 * restorable-field scoping live server-side (Stages 1-3). This component
 * only renders whatever the server already computed and calls the existing
 * restoreContentRevisionAction — no restore logic is duplicated here.
 *
 * This is a revision-DETAIL view, not a diff — no diff library exists in
 * this codebase and none is introduced for this one feature (see the Stage
 * 4 audit).
 */

const CHANGE_SOURCE_LABELS: Record<ContentRevisionSummary["changeSource"], string> = {
  MANUAL_EDIT: "Manual Edit",
  AI_REGENERATION: "AI Regeneration",
  RESTORE: "Restore",
};

type CurrentContentSnapshot = {
  title: string;
  metaTitle: string | null;
  metaDescription: string | null;
  body: string | null;
};

type ContentVersionHistoryProps = {
  contentId: string;
  current: CurrentContentSnapshot;
  revisions: ContentRevisionSummary[];
};

/** Never renders createdByUserId — a null createdBy (system-originated, or the user has since been deleted) always falls back to a friendly label instead. */
function formatAuthorName(revision: ContentRevisionSummary): string {
  return revision.createdBy ? `${revision.createdBy.firstName} ${revision.createdBy.lastName}` : "Unknown user";
}

export default function ContentVersionHistory({ contentId, current, revisions }: ContentVersionHistoryProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [previewRevision, setPreviewRevision] = useState<ContentRevisionSummary | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  function handleRestore(revision: ContentRevisionSummary) {
    const confirmed = window.confirm(
      `Restore to revision #${revision.revisionNumber} from ${revision.createdAt.toLocaleString()}? The current version will be saved as a new revision first.`
    );
    if (!confirmed) return;

    setRestoringId(revision.id);
    startTransition(async () => {
      const result = await restoreContentRevisionAction({ contentId, revisionId: revision.id });
      setRestoringId(null);
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      toast.success(result.data.noOp ? "This is already the current version." : "Content restored.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-medium text-slate-700">Current</span>
          <span className="truncate text-xs text-slate-500">{current.title}</span>
        </div>
        <Badge variant="secondary">Current</Badge>
      </div>

      {revisions.length === 0 ? (
        <p className="text-sm text-slate-500">No edit history yet — changes will appear here.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {revisions.map((revision) => (
            <li
              key={revision.id}
              className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-700">Revision #{revision.revisionNumber}</span>
                  <Badge variant="outline">{CHANGE_SOURCE_LABELS[revision.changeSource]}</Badge>
                </div>
                <span className="text-xs text-slate-500">
                  {formatAuthorName(revision)} · {revision.createdAt.toLocaleString()}
                </span>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setPreviewRevision(revision)} disabled={isPending}>
                  View
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => handleRestore(revision)} disabled={isPending}>
                  {isPending && restoringId === revision.id ? "Restoring…" : "Restore"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={previewRevision !== null} onOpenChange={(open) => !open && setPreviewRevision(null)}>
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
          {previewRevision && (
            <>
              <DialogHeader>
                <DialogTitle>Revision #{previewRevision.revisionNumber}</DialogTitle>
                <DialogDescription>
                  {formatAuthorName(previewRevision)} · {previewRevision.createdAt.toLocaleString()}
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3 text-sm">
                <div>
                  <p className="text-xs font-medium text-slate-500">Title</p>
                  <p>{previewRevision.title}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500">Meta title</p>
                  <p>{previewRevision.metaTitle ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500">Meta description</p>
                  <p>{previewRevision.metaDescription ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500">Body</p>
                  <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3">
                    {previewRevision.body ?? "—"}
                  </div>
                </div>
              </div>
              <DialogFooter showCloseButton />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
