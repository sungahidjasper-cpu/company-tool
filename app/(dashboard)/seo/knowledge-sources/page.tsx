import Link from "next/link";
import { BookMarked, Plus } from "lucide-react";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EmptyState from "@/components/dashboard/EmptyState";
import PageContainer from "@/components/dashboard/PageContainer";
import RecordActionButton from "@/components/dashboard/RecordActionButton";
import StatusBadge from "@/components/dashboard/StatusBadge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  archiveKnowledgeSource,
  restoreKnowledgeSource,
  verifyKnowledgeSourceFreshness,
} from "@/features/seo/actions/knowledge-source.actions";
import { listKnowledgeSources } from "@/features/seo/services/knowledge-source.service";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import { cn } from "@/lib/utils";

type KnowledgeSourcesPageProps = {
  searchParams: Promise<{ status?: string }>;
};

export default async function KnowledgeSourcesPage({ searchParams }: KnowledgeSourcesPageProps) {
  const user = await requireUser();
  const canManage = Permissions.manageSeoProjects(user.role);

  const sp = await searchParams;
  const showingArchived = sp.status === "archived";

  // listKnowledgeSources({ includeArchived: true }) returns everything;
  // the Active/Archived split below is presentation-only filtering — no
  // second backend call, and no change to Stage 2's service.
  const allSources = await listKnowledgeSources(user.companyId, { includeArchived: true });
  const sources = allSources.filter((source) => (showingArchived ? source.deletedAt : !source.deletedAt));

  return (
    <PageContainer>
      <DashboardHeader
        title="Knowledge Sources"
        description="Authoritative sources your team has verified — link them to an SEO project to ground AI-generated content."
        actions={
          canManage ? (
            <Link href="/seo/knowledge-sources/new" className={cn(buttonVariants())}>
              <Plus size={16} /> New knowledge source
            </Link>
          ) : undefined
        }
      />

      <div className="flex gap-2">
        <Link
          href="/seo/knowledge-sources"
          className={cn(buttonVariants({ variant: showingArchived ? "outline" : "secondary", size: "sm" }))}
        >
          Active
        </Link>
        <Link
          href="/seo/knowledge-sources?status=archived"
          className={cn(buttonVariants({ variant: showingArchived ? "secondary" : "outline", size: "sm" }))}
        >
          Archived
        </Link>
      </div>

      {sources.length === 0 ? (
        <EmptyState
          icon={BookMarked}
          title={showingArchived ? "No archived knowledge sources" : "No knowledge sources yet"}
          description={
            showingArchived
              ? undefined
              : "Add a source your team has verified, then link it to an SEO project."
          }
        />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>URL</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last verified</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sources.map((source) => (
                <TableRow key={source.id}>
                  <TableCell>
                    {canManage ? (
                      <Link href={`/seo/knowledge-sources/${source.id}/edit`} className="font-medium hover:underline">
                        {source.title}
                      </Link>
                    ) : (
                      <span className="font-medium">{source.title}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-slate-500">{source.sourceType}</TableCell>
                  <TableCell className="max-w-xs truncate text-slate-500">
                    {source.url ? (
                      <a href={source.url} target="_blank" rel="noreferrer" className="hover:underline">
                        {source.url}
                      </a>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={source.deletedAt ? "ARCHIVED" : "ACTIVE"} />
                  </TableCell>
                  <TableCell className="text-slate-500">
                    {source.lastVerifiedAt ? source.lastVerifiedAt.toLocaleString() : "Never verified"}
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {!source.deletedAt && source.url && (
                          <RecordActionButton
                            id={source.id}
                            action={verifyKnowledgeSourceFreshness}
                            label="Verify URL"
                            successMessage="Knowledge source verified"
                          />
                        )}
                        {source.deletedAt ? (
                          <RecordActionButton
                            id={source.id}
                            action={restoreKnowledgeSource}
                            label="Restore"
                            successMessage="Knowledge source restored"
                          />
                        ) : (
                          <RecordActionButton
                            id={source.id}
                            action={archiveKnowledgeSource}
                            label="Archive"
                            variant="destructive"
                            confirmMessage="Archive this knowledge source?"
                            successMessage="Knowledge source archived"
                          />
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </PageContainer>
  );
}
