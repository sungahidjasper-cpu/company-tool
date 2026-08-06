import Link from "next/link";
import { Plus, Users } from "lucide-react";

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
  archiveClient,
  restoreClient,
} from "@/features/clients/actions/client.actions";
import { listClients } from "@/features/clients/services/client.service";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import { getTotalPages } from "@/lib/pagination";
import { cn } from "@/lib/utils";

type ClientsPageProps = {
  searchParams: Promise<{ page?: string; q?: string; status?: string }>;
};

export default async function ClientsPage({ searchParams }: ClientsPageProps) {
  const user = await requireUser();
  const canManage = Permissions.manageClients(user.role);

  const params = await searchParams;
  const { clients, totalCount, page, pageSize } = await listClients(
    user.companyId,
    params
  );
  const totalPages = getTotalPages(totalCount, pageSize);
  const showingArchived = params.status === "archived";

  return (
    <PageContainer>
      <DashboardHeader
        title="Clients"
        description="Manage your company's clients."
        actions={
          canManage ? (
            <Link href="/clients/new" className={cn(buttonVariants())}>
              <Plus size={16} /> New client
            </Link>
          ) : undefined
        }
      />

      <div className="flex items-center justify-between gap-4">
        <SearchInput
          action="/clients"
          defaultValue={params.q}
          placeholder="Search clients..."
          hiddenFields={showingArchived ? { status: "archived" } : undefined}
        />

        <div className="flex gap-2">
          <Link
            href="/clients"
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
            href="/clients?status=archived"
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

      {clients.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No clients found"
          description="Try adjusting your search, or create the first client."
        />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((client) => (
                <TableRow key={client.id}>
                  <TableCell>
                    <Link
                      href={`/clients/${client.id}`}
                      className="font-medium hover:underline"
                    >
                      {client.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-slate-500">
                    {client.email ?? "—"}
                  </TableCell>
                  <TableCell className="text-slate-500">
                    {client.owner
                      ? `${client.owner.firstName} ${client.owner.lastName}`
                      : "Unassigned"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      status={client.deletedAt ? "ARCHIVED" : client.status}
                    />
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      {client.deletedAt ? (
                        <RecordActionButton
                          id={client.id}
                          action={restoreClient}
                          label="Restore"
                          successMessage="Client restored"
                        />
                      ) : (
                        <RecordActionButton
                          id={client.id}
                          action={archiveClient}
                          label="Archive"
                          variant="destructive"
                          confirmMessage="Archive this client?"
                          successMessage="Client archived"
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
          return `/clients?${sp.toString()}`;
        }}
      />
    </PageContainer>
  );
}
