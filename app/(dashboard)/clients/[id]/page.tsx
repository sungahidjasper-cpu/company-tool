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
  addClientNote,
  archiveClient,
  restoreClient,
} from "@/features/clients/actions/client.actions";
import { getClientById } from "@/features/clients/services/client.service";
import { listFilesFor } from "@/features/files/services/file.service";
import { requireUser } from "@/lib/auth";
import { assertCompanyAccess, Permissions } from "@/lib/authorization";
import { cn } from "@/lib/utils";

type ClientDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ClientDetailPage({
  params,
}: ClientDetailPageProps) {
  const { id } = await params;
  const user = await requireUser();

  const client = await getClientById(id);
  if (!client) {
    notFound();
  }

  assertCompanyAccess(user, client.companyId);

  const canManage = Permissions.manageClients(user.role);
  const files = await listFilesFor("client", client.id);

  return (
    <PageContainer>
      <DashboardHeader
        title={client.name}
        description={client.email ?? "No email on file"}
        actions={
          canManage ? (
            <div className="flex gap-2">
              <Link
                href={`/clients/${client.id}/edit`}
                className={cn(buttonVariants({ variant: "outline" }))}
              >
                <Pencil size={16} /> Edit
              </Link>
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
              <StatusBadge
                status={client.deletedAt ? "ARCHIVED" : client.status}
              />
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Phone</span>
              <span>{client.phone ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Website</span>
              <span>{client.website ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Industry</span>
              <span>{client.industry ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Owner</span>
              <span>
                {client.owner
                  ? `${client.owner.firstName} ${client.owner.lastName}`
                  : "Unassigned"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contacts</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {client.contacts.length === 0 && (
              <p className="text-sm text-slate-500">No contacts yet.</p>
            )}
            {client.contacts.map((contact) => (
              <div key={contact.id} className="text-sm">
                <p className="font-medium">{contact.name}</p>
                <p className="text-slate-500">
                  {contact.email ?? contact.phone ?? "No contact info"}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Projects</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {client.projects.length === 0 && (
              <p className="text-sm text-slate-500">No projects yet.</p>
            )}
            {client.projects.map((project) => (
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Internal notes</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <NoteForm action={addClientNote.bind(null, client.id)} />
            <NotesList notes={client.notes} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Activity timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityTimeline activities={client.activities} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Files</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {canManage && (
            <FileUploadForm entityType="client" entityId={client.id} />
          )}
          <FileList files={files} canDelete={canManage} />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
