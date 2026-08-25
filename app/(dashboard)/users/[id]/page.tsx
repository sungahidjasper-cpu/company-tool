import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";

import ActivityTimeline from "@/components/dashboard/ActivityTimeline";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import FileList from "@/components/dashboard/FileList";
import FileUploadForm from "@/components/dashboard/FileUploadForm";
import PageContainer from "@/components/dashboard/PageContainer";
import RecordActionButton from "@/components/dashboard/RecordActionButton";
import StatusBadge from "@/components/dashboard/StatusBadge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  activateUser,
  archiveUser,
  restoreUser,
  suspendUser,
} from "@/features/users/actions/user.actions";
import { getUserById } from "@/features/users/services/user.service";
import { listFilesFor } from "@/features/files/services/file.service";
import { requireUser } from "@/lib/auth";
import { assertCompanyAccess, Permissions } from "@/lib/authorization";
import { cn, formatEnumLabel } from "@/lib/utils";

type UserDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function UserDetailPage({
  params,
}: UserDetailPageProps) {
  const { id } = await params;
  const actor = await requireUser();

  const targetUser = await getUserById(id);
  if (!targetUser) {
    notFound();
  }

  assertCompanyAccess(actor, targetUser.companyId);

  const canManage = Permissions.manageUsers(actor.role);
  const isSelf = actor.id === targetUser.id;
  const files = await listFilesFor("user", targetUser.id);

  return (
    <PageContainer>
      <DashboardHeader
        title={`${targetUser.firstName} ${targetUser.lastName}`}
        description={targetUser.email}
        actions={
          canManage ? (
            <Link
              href={`/users/${targetUser.id}/edit`}
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              <Pencil size={16} /> Edit
            </Link>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Account</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Role</span>
              <span>{formatEnumLabel(targetUser.role)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Status</span>
              <StatusBadge
                status={targetUser.deletedAt ? "ARCHIVED" : targetUser.status}
              />
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Joined</span>
              <span>{targetUser.createdAt.toLocaleDateString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Last login</span>
              <span>
                {targetUser.lastLoginAt
                  ? targetUser.lastLoginAt.toLocaleDateString()
                  : "Never"}
              </span>
            </div>

            {canManage && !isSelf && (
              <div className="flex flex-wrap gap-2 pt-2">
                {targetUser.deletedAt ? (
                  <RecordActionButton
                    id={targetUser.id}
                    action={restoreUser}
                    label="Restore"
                    successMessage="User restored"
                  />
                ) : (
                  <>
                    {targetUser.status === "SUSPENDED" ? (
                      <RecordActionButton
                        id={targetUser.id}
                        action={activateUser}
                        label="Activate"
                        successMessage="User activated"
                      />
                    ) : (
                      <RecordActionButton
                        id={targetUser.id}
                        action={suspendUser}
                        label="Suspend"
                        successMessage="User suspended"
                      />
                    )}
                    <RecordActionButton
                      id={targetUser.id}
                      action={archiveUser}
                      label="Archive"
                      variant="destructive"
                      confirmMessage="Archive this user?"
                      successMessage="User archived"
                    />
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Owned projects</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {targetUser.ownedProjects.length === 0 && (
              <p className="text-sm text-slate-500">No owned projects.</p>
            )}
            {targetUser.ownedProjects.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="text-sm hover:underline"
              >
                {project.name}
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Assigned projects</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {targetUser.assignedProjects.length === 0 && (
              <p className="text-sm text-slate-500">
                No assigned projects.
              </p>
            )}
            {targetUser.assignedProjects.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="text-sm hover:underline"
              >
                {project.name}
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Activity timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <ActivityTimeline activities={targetUser.targetedActivities} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Files</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {canManage && (
            <FileUploadForm entityType="user" entityId={targetUser.id} />
          )}
          <FileList files={files} canDelete={canManage} />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
