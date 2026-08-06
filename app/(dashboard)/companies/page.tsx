import Link from "next/link";
import { Building2, Plus } from "lucide-react";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EmptyState from "@/components/dashboard/EmptyState";
import PageContainer from "@/components/dashboard/PageContainer";
import Pagination from "@/components/dashboard/Pagination";
import RecordActionButton from "@/components/dashboard/RecordActionButton";
import SearchInput from "@/components/dashboard/SearchInput";
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
  archiveCompany,
  restoreCompany,
} from "@/features/companies/actions/company.actions";
import { listCompanies } from "@/features/companies/services/company.service";
import { requireUser } from "@/lib/auth";
import { assertPermission, Permissions } from "@/lib/authorization";
import { getTotalPages } from "@/lib/pagination";
import { cn } from "@/lib/utils";

type CompaniesPageProps = {
  searchParams: Promise<{ page?: string; q?: string; status?: string }>;
};

export default async function CompaniesPage({
  searchParams,
}: CompaniesPageProps) {
  const user = await requireUser();
  assertPermission(user, Permissions.manageCompanies);

  const params = await searchParams;
  const { companies, totalCount, page, pageSize } =
    await listCompanies(params);
  const totalPages = getTotalPages(totalCount, pageSize);
  const showingArchived = params.status === "archived";

  return (
    <PageContainer>
      <DashboardHeader
        title="Companies"
        description="Manage every tenant workspace on the platform."
        actions={
          <Link href="/companies/new" className={cn(buttonVariants())}>
            <Plus size={16} /> New company
          </Link>
        }
      />

      <div className="flex items-center justify-between gap-4">
        <SearchInput
          action="/companies"
          defaultValue={params.q}
          placeholder="Search companies..."
          hiddenFields={showingArchived ? { status: "archived" } : undefined}
        />

        <div className="flex gap-2">
          <Link
            href="/companies"
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
            href="/companies?status=archived"
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

      {companies.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No companies found"
          description="Try adjusting your search, or create the first company."
        />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((company) => (
                <TableRow key={company.id}>
                  <TableCell>
                    <Link
                      href={`/companies/${company.id}`}
                      className="font-medium hover:underline"
                    >
                      {company.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-slate-500">
                    {company.slug}
                  </TableCell>
                  <TableCell className="text-slate-500">
                    {company.industry ?? "—"}
                  </TableCell>
                  <TableCell className="text-slate-500">
                    {company.createdAt.toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    {company.deletedAt ? (
                      <RecordActionButton
                        id={company.id}
                        action={restoreCompany}
                        label="Restore"
                        successMessage="Company restored"
                      />
                    ) : (
                      <RecordActionButton
                        id={company.id}
                        action={archiveCompany}
                        label="Archive"
                        variant="destructive"
                        confirmMessage="Archive this company?"
                        successMessage="Company archived"
                      />
                    )}
                  </TableCell>
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
          return `/companies?${sp.toString()}`;
        }}
      />
    </PageContainer>
  );
}
