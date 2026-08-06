import Link from "next/link";
import { Plus, UserCog } from "lucide-react";

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
  activateUser,
  archiveUser,
  restoreUser,
  suspendUser,
} from "@/features/users/actions/user.actions";
import { listUsers } from "@/features/users/services/user.service";
import { requireUser } from "@/lib/auth";
import { assertPermission, Permissions } from "@/lib/authorization";
import { getTotalPages } from "@/lib/pagination";
import { cn, formatEnumLabel } from "@/lib/utils";

type UsersPageProps = {
  searchParams: Promise<{ page?: string; q?: string; status?: string }>;
};

export default async function UsersPage({ searchParams }: UsersPageProps) {
  const user = await requireUser();
  assertPermission(user, Permissions.manageUsers);

  const params = await searchParams;
  const { users, totalCount, page, pageSize } = await listUsers(
    user.companyId,
    params
  );
  const totalPages = getTotalPages(totalCount, pageSize);
  const showingArchived = params.status === "archived";

  return (
    <PageContainer>
      <DashboardHeader
        title="Users"
        description="Manage the people in your workspace."
        actions={
          <Link href="/users/new" className={cn(buttonVariants())}>
            <Plus size={16} /> New user
          </Link>
        }
      />

      <div className="flex items-center justify-between gap-4">
        <SearchInput
          action="/users"
          defaultValue={params.q}
          placeholder="Search users..."
          hiddenFields={showingArchived ? { status: "archived" } : undefined}
        />

        <div className="flex gap-2">
          <Link
            href="/users"
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
            href="/users?status=archived"
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

      {users.length === 0 ? (
        <EmptyState
          icon={UserCog}
          title="No users found"
          description="Try adjusting your search, or invite the first teammate."
        />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <Link
                      href={`/users/${u.id}`}
                      className="font-medium hover:underline"
                    >
                      {u.firstName} {u.lastName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-slate-500">{u.email}</TableCell>
                  <TableCell className="text-slate-500">
                    {formatEnumLabel(u.role)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={u.deletedAt ? "ARCHIVED" : u.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {u.deletedAt ? (
                        <RecordActionButton
                          id={u.id}
                          action={restoreUser}
                          label="Restore"
                          successMessage="User restored"
                        />
                      ) : (
                        <>
                          {u.status === "SUSPENDED" ? (
                            <RecordActionButton
                              id={u.id}
                              action={activateUser}
                              label="Activate"
                              successMessage="User activated"
                            />
                          ) : (
                            <RecordActionButton
                              id={u.id}
                              action={suspendUser}
                              label="Suspend"
                              successMessage="User suspended"
                            />
                          )}
                          <RecordActionButton
                            id={u.id}
                            action={archiveUser}
                            label="Archive"
                            variant="destructive"
                            confirmMessage="Archive this user?"
                            successMessage="User archived"
                          />
                        </>
                      )}
                    </div>
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
          return `/users?${sp.toString()}`;
        }}
      />
    </PageContainer>
  );
}
