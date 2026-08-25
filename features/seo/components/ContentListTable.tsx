"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  archiveContent,
  bulkArchiveContent,
  bulkDeleteContent,
  bulkPublishContent,
  bulkRestoreContent,
  restoreContent,
} from "@/features/seo/actions/content.actions";
import BulkActionsBar from "@/components/dashboard/BulkActionsBar";
import RecordActionButton from "@/components/dashboard/RecordActionButton";
import StatusBadge from "@/components/dashboard/StatusBadge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type ContentRow = {
  id: string;
  title: string;
  status: string;
  deletedAt: Date | null;
  author: { firstName: string; lastName: string } | null;
  _count: { keywords: number };
};

type ContentListTableProps = {
  seoProjectId: string;
  content: ContentRow[];
  canManage: boolean;
  showingArchived: boolean;
};

export default function ContentListTable({
  seoProjectId,
  content,
  canManage,
  showingArchived,
}: ContentListTableProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  const allSelected = content.length > 0 && selected.size === content.length;

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(content.map((c) => c.id)));
  };

  const toggleOne = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runBulk = (
    action: (
      seoProjectId: string,
      ids: string[]
    ) => Promise<{ success: boolean; message?: string; data?: { count: number; skippedCount?: number } }>,
    successVerb: string
  ) => {
    startTransition(async () => {
      const result = await action(seoProjectId, Array.from(selected));
      if (!result.success) {
        toast.error(result.message ?? "Something went wrong.");
        return;
      }
      // skippedCount is only ever populated by bulkDeleteContent (revision-protected items) —
      // every other bulk action's data has no such field, so this always falls through to the
      // original message for Restore/Archive/Publish, unchanged.
      toast.success(
        result.data?.skippedCount
          ? `${result.data.count} content item(s) ${successVerb}. ${result.data.skippedCount} skipped — they have edit history and cannot be permanently deleted.`
          : `${result.data?.count ?? 0} content item(s) ${successVerb}`
      );
      setSelected(new Set());
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {canManage && (
        <BulkActionsBar
          selectedCount={selected.size}
          onClear={() => setSelected(new Set())}
          actions={
            showingArchived
              ? [
                  {
                    label: "Restore",
                    isPending,
                    onClick: () => runBulk(bulkRestoreContent, "restored"),
                  },
                  {
                    label: "Delete permanently",
                    variant: "destructive",
                    isPending,
                    onClick: () => {
                      if (window.confirm(`Permanently delete ${selected.size} item(s)? This cannot be undone.`)) {
                        runBulk(bulkDeleteContent, "deleted");
                      }
                    },
                  },
                ]
              : [
                  {
                    label: "Publish",
                    isPending,
                    onClick: () => runBulk(bulkPublishContent, "published"),
                  },
                  {
                    label: "Archive",
                    variant: "destructive",
                    isPending,
                    onClick: () => runBulk(bulkArchiveContent, "archived"),
                  },
                ]
          }
        />
      )}

      <div className="rounded-xl border border-slate-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              {canManage && (
                <TableHead className="w-8">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                </TableHead>
              )}
              <TableHead>Title</TableHead>
              <TableHead>Author</TableHead>
              <TableHead>Keywords</TableHead>
              <TableHead>Status</TableHead>
              {canManage && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {content.map((item) => (
              <TableRow key={item.id}>
                {canManage && (
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={selected.has(item.id)}
                      onChange={() => toggleOne(item.id)}
                    />
                  </TableCell>
                )}
                <TableCell>
                  <Link
                    href={`/seo/${seoProjectId}/content/${item.id}`}
                    className="font-medium hover:underline"
                  >
                    {item.title}
                  </Link>
                </TableCell>
                <TableCell className="text-slate-500">
                  {item.author
                    ? `${item.author.firstName} ${item.author.lastName}`
                    : "Unassigned"}
                </TableCell>
                <TableCell className="text-slate-500">{item._count.keywords}</TableCell>
                <TableCell>
                  <StatusBadge status={item.deletedAt ? "ARCHIVED" : item.status} />
                </TableCell>
                {canManage && (
                  <TableCell className="text-right">
                    {item.deletedAt ? (
                      <RecordActionButton
                        id={item.id}
                        action={restoreContent}
                        label="Restore"
                        successMessage="Content restored"
                      />
                    ) : (
                      <RecordActionButton
                        id={item.id}
                        action={archiveContent}
                        label="Archive"
                        variant="destructive"
                        confirmMessage="Archive this content?"
                        successMessage="Content archived"
                      />
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
