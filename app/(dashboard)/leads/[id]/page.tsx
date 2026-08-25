import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";

import ActivityTimeline from "@/components/dashboard/ActivityTimeline";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import FileList from "@/components/dashboard/FileList";
import FileUploadForm from "@/components/dashboard/FileUploadForm";
import NoteForm from "@/components/dashboard/NoteForm";
import NotesList from "@/components/dashboard/NotesList";
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
  addLeadNote,
  archiveLead,
  deleteLeadNote,
  restoreLead,
  updateLeadNote,
} from "@/features/leads/actions/lead.actions";
import LeadTaskList from "@/features/leads/components/LeadTaskList";
import { getLeadById } from "@/features/leads/services/lead.service";
import { listFilesFor } from "@/features/files/services/file.service";
import { requireUser } from "@/lib/auth";
import { assertCompanyAccess, Permissions } from "@/lib/authorization";
import { cn } from "@/lib/utils";

type LeadDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function LeadDetailPage({ params }: LeadDetailPageProps) {
  const { id } = await params;
  const user = await requireUser();

  const lead = await getLeadById(id);
  if (!lead) {
    notFound();
  }

  assertCompanyAccess(user, lead.companyId);

  const canManage = Permissions.manageLeads(user.role);
  const canAct = canManage || lead.assignedUserId === user.id;
  const files = await listFilesFor("lead", lead.id);

  return (
    <PageContainer>
      <DashboardHeader
        title={lead.name}
        description={lead.companyName ?? lead.email ?? "No company on file"}
        actions={
          canManage ? (
            <div className="flex gap-2">
              <Link
                href={`/leads/${lead.id}/edit`}
                className={cn(buttonVariants({ variant: "outline" }))}
              >
                <Pencil size={16} /> Edit
              </Link>
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
            </div>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Status</span>
              <StatusBadge status={lead.deletedAt ? "ARCHIVED" : lead.status} />
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Email</span>
              <span>{lead.email ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Phone</span>
              <span>{lead.phone ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Source</span>
              <span>{lead.source ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Deal value</span>
              <span>{lead.value ? `$${Number(lead.value).toLocaleString()}` : "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Assigned user</span>
              <span>
                {lead.assignedUser
                  ? `${lead.assignedUser.firstName} ${lead.assignedUser.lastName}`
                  : "Unassigned"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Created</span>
              <span>{lead.createdAt.toLocaleDateString()}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Related records</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Client</span>
              {lead.client ? (
                <Link href={`/clients/${lead.client.id}`} className="hover:underline">
                  {lead.client.name}
                </Link>
              ) : (
                <span>—</span>
              )}
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Project</span>
              {lead.project ? (
                <Link href={`/projects/${lead.project.id}`} className="hover:underline">
                  {lead.project.name}
                </Link>
              ) : (
                <span>—</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            <LeadTaskList leadId={lead.id} tasks={lead.tasks} />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <NoteForm action={addLeadNote.bind(null, lead.id)} />
            <NotesList
              notes={lead.notes}
              currentUserId={user.id}
              canManage={canManage}
              onEdit={updateLeadNote}
              onDelete={deleteLeadNote}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Activity timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityTimeline activities={lead.activities} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Files</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {canAct && <FileUploadForm entityType="lead" entityId={lead.id} />}
          <FileList files={files} canDelete={canManage} />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
