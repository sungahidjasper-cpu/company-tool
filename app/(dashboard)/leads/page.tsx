import Link from "next/link";
import { Plus, Target } from "lucide-react";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EmptyState from "@/components/dashboard/EmptyState";
import PageContainer from "@/components/dashboard/PageContainer";
import Pagination from "@/components/dashboard/Pagination";
import RecordActionButton from "@/components/dashboard/RecordActionButton";
import SearchInput from "@/components/dashboard/SearchInput";
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
  archiveLead,
  restoreLead,
} from "@/features/leads/actions/lead.actions";
import { listLeads } from "@/features/leads/services/lead.service";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import { getTotalPages } from "@/lib/pagination";
import { cn } from "@/lib/utils";

type LeadsPageProps = {
  searchParams: Promise<{ page?: string; q?: string; status?: string }>;
};

export default async function LeadsPage({ searchParams }: LeadsPageProps) {
  const user = await requireUser();
  const canManage = Permissions.manageLeads(user.role);

  const params = await searchParams;
  const { leads, totalCount, page, pageSize } = await listLeads(
    user.companyId,
    params
  );
  const totalPages = getTotalPages(totalCount, pageSize);
  const showingArchived = params.status === "archived";

  return (
    <PageContainer>
      <DashboardHeader
        title="Leads"
        description="Track prospective deals moving through your sales pipeline."
        actions={
          <div className="flex gap-2">
            <Link href="/pipeline" className={cn(buttonVariants({ variant: "outline" }))}>
              View pipeline
            </Link>
            {canManage && (
              <Link href="/leads/new" className={cn(buttonVariants())}>
                <Plus size={16} /> New lead
              </Link>
            )}
          </div>
        }
      />

      <div className="flex items-center justify-between gap-4">
        <SearchInput
          action="/leads"
          defaultValue={params.q}
          placeholder="Search leads..."
          hiddenFields={showingArchived ? { status: "archived" } : undefined}
        />

        <div className="flex gap-2">
          <Link
            href="/leads"
            className={cn(
              buttonVariants({
                variant: showingArchived ? "outline" : "secondary",
                size: "sm",
              })
            )}
          >
            Active
          </Link>
          <Link
            href="/leads?status=archived"
            className={cn(
              buttonVariants({
                variant: showingArchived ? "secondary" : "outline",
                size: "sm",
              })
            )}
          >
            Archived
          </Link>
        </div>
      </div>

      {leads.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No leads found"
          description="Try adjusting your search, or create the first lead."
        />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Assigned</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((lead) => (
                <TableRow key={lead.id}>
                  <TableCell>
                    <Link
                      href={`/leads/${lead.id}`}
                      className="font-medium hover:underline"
                    >
                      {lead.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-slate-500">
                    {lead.companyName ?? "—"}
                  </TableCell>
                  <TableCell className="text-slate-500">
                    {lead.assignedUser
                      ? `${lead.assignedUser.firstName} ${lead.assignedUser.lastName}`
                      : "Unassigned"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      status={lead.deletedAt ? "ARCHIVED" : lead.status}
                    />
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      {lead.deletedAt ? (
                        <RecordActionButton
                          id={lead.id}
                          action={restoreLead}
                          label="Restore"
                          successMessage="Lead restored"
                        />
                      ) : (
                        <RecordActionButton
                          id={lead.id}
                          action={archiveLead}
                          label="Archive"
                          variant="destructive"
                          confirmMessage="Archive this lead?"
                          successMessage="Lead archived"
                        />
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Pagination
        page={page}
        totalPages={totalPages}
        buildHref={(targetPage) => {
          const sp = new URLSearchParams();
          if (params.q) sp.set("q", params.q);
          if (params.status) sp.set("status", params.status);
          sp.set("page", String(targetPage));
          return `/leads?${sp.toString()}`;
        }}
      />
    </PageContainer>
  );
}
