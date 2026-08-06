import Link from "next/link";
import { Building2, CheckSquare, FolderKanban, Upload, UserCog, Users } from "lucide-react";

import ProjectPickerDialog from "@/components/dashboard/ProjectPickerDialog";
import { buttonVariants } from "@/components/ui/button";
import { listProjectOptions } from "@/features/projects/services/project.service";
import { Permissions } from "@/lib/authorization";
import type { UserRole } from "@/lib/generated/prisma/enums";
import { cn } from "@/lib/utils";

type QuickActionsProps = {
  role: UserRole;
  companyId: string;
};

export default async function QuickActions({ role, companyId }: QuickActionsProps) {
  const canManageCompanies = Permissions.manageCompanies(role);
  const canManageUsers = Permissions.manageUsers(role);
  const canManageClients = Permissions.manageClients(role);
  const canManageProjects = Permissions.manageProjects(role);

  const projectOptions = canManageProjects
    ? await listProjectOptions(companyId)
    : [];

  return (
    <div className="flex flex-wrap gap-2">
      {canManageCompanies && (
        <Link href="/companies/new" className={cn(buttonVariants({ variant: "outline" }))}>
          <Building2 size={16} /> New Company
        </Link>
      )}
      {canManageUsers && (
        <Link href="/users/new" className={cn(buttonVariants({ variant: "outline" }))}>
          <UserCog size={16} /> New User
        </Link>
      )}
      {canManageClients && (
        <Link href="/clients/new" className={cn(buttonVariants({ variant: "outline" }))}>
          <Users size={16} /> New Client
        </Link>
      )}
      {canManageProjects && (
        <Link href="/projects/new" className={cn(buttonVariants({ variant: "outline" }))}>
          <FolderKanban size={16} /> New Project
        </Link>
      )}
      {canManageProjects && (
        <ProjectPickerDialog
          triggerLabel="New Task"
          triggerIcon={CheckSquare}
          dialogTitle="New task"
          dialogDescription="Pick which project this task belongs to."
          projectOptions={projectOptions}
          buildHref={(projectId) => `/projects/${projectId}/tasks/new`}
        />
      )}
      {canManageProjects && (
        <ProjectPickerDialog
          triggerLabel="Upload File"
          triggerIcon={Upload}
          dialogTitle="Upload a file"
          dialogDescription="Pick which project to attach the file to, then upload it from that project's Files section."
          projectOptions={projectOptions}
          buildHref={(projectId) => `/projects/${projectId}`}
        />
      )}
    </div>
  );
}
