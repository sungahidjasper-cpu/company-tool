import Link from "next/link";
import { Building2, FolderKanban, UserCog, Users } from "lucide-react";

import ActivityTimeline from "@/components/dashboard/ActivityTimeline";
import DashboardGrid from "@/components/dashboard/DashboardGrid";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import StatsCard from "@/components/dashboard/StatsCard";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getDashboardSummary } from "@/features/dashboard/services/dashboard.service";
import { requireUser } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/authorization";

export default async function DashboardPage() {
  const user = await requireUser();
  const superAdmin = isSuperAdmin(user.role);

  const summary = await getDashboardSummary(user.companyId, superAdmin);

  return (
    <PageContainer>
      <DashboardHeader title="Dashboard" />

      <DashboardGrid>
        {superAdmin && (
          <StatsCard
            title="Companies"
            value={summary.companiesCount ?? 0}
            icon={Building2}
          />
        )}
        <StatsCard title="Users" value={summary.usersCount} icon={UserCog} />
        <StatsCard title="Clients" value={summary.clientsCount} icon={Users} />
        <StatsCard
          title="Projects"
          value={summary.projectsCount}
          icon={FolderKanban}
        />
      </DashboardGrid>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityTimeline activities={summary.recentActivity} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent projects</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {summary.recentProjects.length === 0 && (
              <p className="text-sm text-slate-500">No projects yet.</p>
            )}
            {summary.recentProjects.map((project) => (
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
            <CardTitle className="text-base">Recent clients</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {summary.recentClients.length === 0 && (
              <p className="text-sm text-slate-500">No clients yet.</p>
            )}
            {summary.recentClients.map((client) => (
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
      </div>
    </PageContainer>
  );
}
