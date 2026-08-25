import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Users, Briefcase, Building2 } from "lucide-react";

import ActivityTimeline from "@/components/dashboard/ActivityTimeline";
import DashboardGrid from "@/components/dashboard/DashboardGrid";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import FileList from "@/components/dashboard/FileList";
import FileUploadForm from "@/components/dashboard/FileUploadForm";
import PageContainer from "@/components/dashboard/PageContainer";
import RecordActionButton from "@/components/dashboard/RecordActionButton";
import StatsCard from "@/components/dashboard/StatsCard";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import CompanyAiLimitsForm from "@/features/companies/components/CompanyAiLimitsForm";
import {
  archiveCompany,
  restoreCompany,
} from "@/features/companies/actions/company.actions";
import {
  getCompanyActivities,
  getCompanyById,
  getCompanyClients,
  getCompanyCounts,
  getCompanyProjects,
  getCompanyUsers,
} from "@/features/companies/services/company.service";
import { listFilesFor } from "@/features/files/services/file.service";
import { getCurrentPeriodSpendUsd } from "@/lib/ai/ai-limit.service";
import { requireUser } from "@/lib/auth";
import { assertCompanyAccess, Permissions } from "@/lib/authorization";
import { cn, formatEnumLabel } from "@/lib/utils";

type CompanyDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function CompanyDetailPage({
  params,
}: CompanyDetailPageProps) {
  const { id } = await params;
  const user = await requireUser();

  const company = await getCompanyById(id);
  if (!company) {
    notFound();
  }

  assertCompanyAccess(user, company.id);
  const canManageFiles = Permissions.manageCompanies(user.role);
  const canManageAiLimits = Permissions.manageCompanies(user.role);
  const canManage = Permissions.manageCompanies(user.role);

  const [counts, recentUsers, recentClients, recentProjects, files, currentPeriodSpendUsd, activities] =
    await Promise.all([
      getCompanyCounts(company.id),
      getCompanyUsers(company.id),
      getCompanyClients(company.id),
      getCompanyProjects(company.id),
      listFilesFor("company", company.id),
      canManageAiLimits ? getCurrentPeriodSpendUsd(company.id) : Promise.resolve(0),
      getCompanyActivities(company.id),
    ]);

  return (
    <PageContainer>
      <DashboardHeader
        title={company.name}
        description={company.industry ?? "No industry set"}
        actions={
          <div className="flex gap-2">
            <Link
              href={`/companies/${company.id}/edit`}
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              <Pencil size={16} /> Edit
            </Link>
            {canManage &&
              (company.deletedAt ? (
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
              ))}
          </div>
        }
      />

      <DashboardGrid>
        <StatsCard
          title="Active users"
          value={counts.activeUsers}
          change={`${counts.totalUsers} total`}
          icon={Users}
        />
        <StatsCard
          title="Active projects"
          value={counts.activeProjects}
          change={`${counts.totalProjects} total`}
          icon={Briefcase}
        />
        <StatsCard
          title="Active clients"
          value={counts.activeClients}
          change={`${counts.totalClients} total`}
          icon={Building2}
        />
      </DashboardGrid>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent users</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {recentUsers.length === 0 && (
              <p className="text-sm text-slate-500">No users yet.</p>
            )}
            {recentUsers.map((u) => (
              <div key={u.id} className="flex items-center justify-between text-sm">
                <span>
                  {u.firstName} {u.lastName}
                </span>
                <span className="text-slate-500">{formatEnumLabel(u.role)}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent clients</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {recentClients.length === 0 && (
              <p className="text-sm text-slate-500">No clients yet.</p>
            )}
            {recentClients.map((client) => (
              <Link
                key={client.id}
                href={`/clients/${client.id}`}
                className="text-sm hover:underline"
              >
                {client.name}
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent projects</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {recentProjects.length === 0 && (
              <p className="text-sm text-slate-500">No projects yet.</p>
            )}
            {recentProjects.map((project) => (
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
          <ActivityTimeline activities={activities} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Files</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {canManageFiles && (
            <FileUploadForm entityType="company" entityId={company.id} />
          )}
          <FileList files={files} canDelete={canManageFiles} />
        </CardContent>
      </Card>

      {canManageAiLimits && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI cost controls</CardTitle>
          </CardHeader>
          <CardContent>
            <CompanyAiLimitsForm
              companyId={company.id}
              aiMonthlyBudgetUsd={company.aiMonthlyBudgetUsd ? Number(company.aiMonthlyBudgetUsd) : null}
              aiRateLimitPerMinute={company.aiRateLimitPerMinute}
              currentPeriodSpendUsd={currentPeriodSpendUsd}
            />
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}
