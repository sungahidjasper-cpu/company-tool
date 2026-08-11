"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  bulkArchiveKeywords,
  bulkDeleteKeywords,
  bulkRestoreKeywords,
} from "@/features/seo/actions/keyword.actions";
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
import { archiveKeyword, restoreKeyword } from "@/features/seo/actions/keyword.actions";
import { formatEnumLabel } from "@/lib/utils";

type KeywordRow = {
  id: string;
  term: string;
  searchVolume: number | null;
  currentRank: number | null;
  priority: string;
  status: string;
  deletedAt: Date | null;
  cluster: { id: string; name: string } | null;
  owner: { firstName: string; lastName: string } | null;
};

type KeywordListTableProps = {
  seoProjectId: string;
  keywords: KeywordRow[];
  canManage: boolean;
  showingArchived: boolean;
};

export default function KeywordListTable({
  seoProjectId,
  keywords,
  canManage,
  showingArchived,
}: KeywordListTableProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  const allSelected = keywords.length > 0 && selected.size === keywords.length;

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(keywords.map((k) => k.id)));
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
    action: (seoProjectId: string, ids: string[]) => Promise<{ success: boolean; message?: string; data?: { count: number } }>,
    successVerb: string
  ) => {
    startTransition(async () => {
      const result = await action(seoProjectId, Array.from(selected));
      if (!result.success) {
        toast.error(result.message ?? "Something went wrong.");
        return;
      }
      toast.success(`${result.data?.count ?? 0} keyword(s) ${successVerb}`);
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
                    onClick: () => runBulk(bulkRestoreKeywords, "restored"),
                  },
                  {
                    label: "Delete permanently",
                    variant: "destructive",
                    isPending,
                    onClick: () => {
                      if (window.confirm(`Permanently delete ${selected.size} keyword(s)? This cannot be undone.`)) {
                        runBulk(bulkDeleteKeywords, "deleted");
                      }
                    },
                  },
                ]
              : [
                  {
                    label: "Archive",
                    variant: "destructive",
                    isPending,
                    onClick: () => runBulk(bulkArchiveKeywords, "archived"),
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
              <TableHead>Term</TableHead>
              <TableHead>Cluster</TableHead>
              <TableHead>Volume</TableHead>
              <TableHead>Rank</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Status</TableHead>
              {canManage && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {keywords.map((keyword) => (
              <TableRow key={keyword.id}>
                {canManage && (
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={selected.has(keyword.id)}
                      onChange={() => toggleOne(keyword.id)}
                    />
                  </TableCell>
                )}
                <TableCell>
                  <Link
                    href={`/seo/${seoProjectId}/keywords/${keyword.id}`}
                    className="font-medium hover:underline"
                  >
                    {keyword.term}
                  </Link>
                </TableCell>
                <TableCell className="text-slate-500">
                  {keyword.cluster?.name ?? "—"}
                </TableCell>
                <TableCell className="text-slate-500">
                  {keyword.searchVolume?.toLocaleString() ?? "—"}
                </TableCell>
                <TableCell className="text-slate-500">
                  {keyword.currentRank ?? "—"}
                </TableCell>
                <TableCell className="text-slate-500">
                  {formatEnumLabel(keyword.priority)}
                </TableCell>
                <TableCell>
                  <StatusBadge status={keyword.deletedAt ? "ARCHIVED" : keyword.status} />
                </TableCell>
                {canManage && (
                  <TableCell className="text-right">
                    {keyword.deletedAt ? (
                      <RecordActionButton
                        id={keyword.id}
                        action={restoreKeyword}
                        label="Restore"
                        successMessage="Keyword restored"
                      />
                    ) : (
                      <RecordActionButton
                        id={keyword.id}
                        action={archiveKeyword}
                        label="Archive"
                        variant="destructive"
                        confirmMessage="Archive this keyword?"
                        successMessage="Keyword archived"
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
