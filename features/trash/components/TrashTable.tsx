"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import EmptyState from "@/components/dashboard/EmptyState";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ActionResult } from "@/lib/action-result";
import { Trash2 } from "lucide-react";

import type { TrashItem } from "@/features/trash/services/trash.service";
import { bulkDeleteContent, getContentDeletionImpact, restoreContent, restoreContentNote } from "@/features/seo/actions/content.actions";
import { bulkDeleteKeywords, restoreKeyword } from "@/features/seo/actions/keyword.actions";
import { restoreSeoProjectNote } from "@/features/seo/actions/seo-project.actions";
import { restoreFile } from "@/features/files/actions/file.actions";
import { restoreLeadNote } from "@/features/leads/actions/lead.actions";
import { restoreProjectNote } from "@/features/projects/actions/project.actions";
import { restoreClientNote } from "@/features/clients/actions/client.actions";
import { restoreTaskComment } from "@/features/tasks/actions/task.actions";

const ENTITY_LABEL: Record<TrashItem["entityType"], string> = {
  content: "Content",
  keyword: "Keyword",
  file: "File",
  note: "Note",
};

const NOTE_RESTORE_BY_PARENT = {
  lead: restoreLeadNote,
  project: restoreProjectNote,
  client: restoreClientNote,
  seoProject: restoreSeoProjectNote,
  content: restoreContentNote,
  task: restoreTaskComment,
} as const;

async function restoreItem(item: TrashItem): Promise<ActionResult> {
  switch (item.identifiers.entityType) {
    case "content":
      return restoreContent(item.identifiers.contentId);
    case "keyword":
      return restoreKeyword(item.identifiers.keywordId);
    case "file":
      return restoreFile(item.identifiers.fileId);
    case "note":
      return NOTE_RESTORE_BY_PARENT[item.identifiers.noteParentType]({ noteId: item.identifiers.noteId });
  }
}

type TrashTableProps = {
  items: TrashItem[];
};

export default function TrashTable({ items }: TrashTableProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  const allSelected = items.length > 0 && selected.size === items.length;

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)));
  };

  const toggleOne = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleRestore = (item: TrashItem) => {
    if (!window.confirm("Restore this item?")) return;
    startTransition(async () => {
      const result = await restoreItem(item);
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      toast.success("Item restored");
      router.refresh();
    });
  };

  const handleBulkRestore = () => {
    if (!window.confirm(`Restore ${selected.size} item(s)?`)) return;
    startTransition(async () => {
      const targets = items.filter((i) => selected.has(i.id));
      const results = await Promise.all(targets.map((item) => restoreItem(item)));
      const failed = results.filter((r) => !r.success).length;
      if (failed > 0) {
        toast.error(`${failed} item(s) could not be restored.`);
      } else {
        toast.success(`${targets.length} item(s) restored`);
      }
      setSelected(new Set());
      router.refresh();
    });
  };

  const handlePurgeContent = (contentId: string, seoProjectId: string, displayName: string) => {
    startTransition(async () => {
      const impact = await getContentDeletionImpact(seoProjectId, [contentId]);
      if (!impact.success) {
        toast.error(impact.message);
        return;
      }
      if (impact.data.blockedCount > 0) {
        window.alert("This content has edit history and cannot be permanently deleted.");
        return;
      }
      const lines = [`Permanently delete "${displayName}"?`, ""];
      const consequences: string[] = [];
      if (impact.data.noteCount > 0) consequences.push(`- ${impact.data.noteCount} note${impact.data.noteCount === 1 ? "" : "s"}`);
      if (impact.data.fileCount > 0) consequences.push(`- ${impact.data.fileCount} file${impact.data.fileCount === 1 ? "" : "s"}`);
      if (impact.data.activityCount > 0) consequences.push(`- ${impact.data.activityCount} activity record${impact.data.activityCount === 1 ? "" : "s"}`);
      if (consequences.length > 0) {
        lines.push("This will also permanently delete:", ...consequences, "");
      }
      lines.push("This cannot be undone.");
      if (!window.confirm(lines.join("\n"))) return;

      const result = await bulkDeleteContent(seoProjectId, [contentId]);
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      toast.success("Content permanently deleted");
      router.refresh();
    });
  };

  const handlePurgeKeyword = (keywordId: string, seoProjectId: string, displayName: string) => {
    if (!window.confirm(`Permanently delete "${displayName}"? This cannot be undone.`)) return;
    startTransition(async () => {
      const result = await bulkDeleteKeywords(seoProjectId, [keywordId]);
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      toast.success("Keyword permanently deleted");
      router.refresh();
    });
  };

  if (items.length === 0) {
    return (
      <EmptyState
        icon={Trash2}
        title="Nothing in Trash"
        description="Deleted content, keywords, files, and notes will appear here."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={handleBulkRestore}>
              {isPending ? "Working..." : "Restore"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              </TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Parent</TableHead>
              <TableHead>Deleted</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={`${item.entityType}-${item.id}`}>
                <TableCell>
                  <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleOne(item.id)} />
                </TableCell>
                <TableCell className="max-w-xs truncate font-medium">{item.displayName}</TableCell>
                <TableCell>
                  <Badge variant="outline">{ENTITY_LABEL[item.entityType]}</Badge>
                </TableCell>
                <TableCell className="text-slate-500">
                  {item.parentHref ? (
                    <a href={item.parentHref} className="hover:underline">
                      {item.parentLabel}
                    </a>
                  ) : (
                    (item.parentLabel ?? "—")
                  )}
                </TableCell>
                <TableCell className="text-slate-500" title={item.deletedAt.toLocaleString()}>
                  Deleted on {item.deletedAt.toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={() => handleRestore(item)}>
                      Restore
                    </Button>
                    {item.purgeAvailable && item.identifiers.entityType === "content" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={isPending}
                        onClick={() => {
                          const ids = item.identifiers;
                          if (ids.entityType !== "content") return;
                          handlePurgeContent(ids.contentId, ids.seoProjectId, item.displayName);
                        }}
                      >
                        Delete permanently
                      </Button>
                    )}
                    {item.purgeAvailable && item.identifiers.entityType === "keyword" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={isPending}
                        onClick={() => {
                          const ids = item.identifiers;
                          if (ids.entityType !== "keyword") return;
                          handlePurgeKeyword(ids.keywordId, ids.seoProjectId, item.displayName);
                        }}
                      >
                        Delete permanently
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
