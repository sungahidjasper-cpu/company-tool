import Link from "next/link";
import {
  BadgeCheck,
  Building2,
  CheckSquare,
  DollarSign,
  FileText,
  FolderKanban,
  Percent,
  Target,
  Trophy,
  UserCog,
  Users,
  XCircle,
} from "lucide-react";

import ActivityTimeline from "@/components/dashboard/ActivityTimeline";
import ActivityTrendChart from "@/components/dashboard/charts/ActivityTrendChart";
import ProjectsPerMonthChart from "@/components/dashboard/charts/ProjectsPerMonthChart";
import TasksByStatusChart from "@/components/dashboard/charts/TasksByStatusChart";
import DashboardGrid from "@/components/dashboard/DashboardGrid";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import QuickActions from "@/components/dashboard/QuickActions";
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
import { formatEnumLabel } from "@/lib/utils";

export default async function DashboardPage() {
  const user = await requireUser();
  const superAdmin = isSuperAdmin(user.role);

  const summary = await getDashboardSummary(user.companyId, superAdmin);

  const totalTasks = summary.taskStatusCounts.reduce(
    (sum, row) => sum + row.count,
    0
  );

  return (
    <PageContainer>
      <DashboardHeader title="Dashboard" />

      <QuickActions role={user.role} companyId={user.companyId} />

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
          title="Active Projects"
          value={summary.projectsCount}
          icon={FolderKanban}
        />
        <StatsCard
          title="Completed Projects"
          value={summary.completedProjectsCount}
          icon={CheckSquare}
        />
        <StatsCard title="Tasks" value={totalTasks} icon={CheckSquare} />
        <StatsCard
          title="File Uploads"
          value={summary.totalFileUploads}
          icon={FileText}
        />
      </DashboardGrid>

      <h2 className="text-lg font-semibold">CRM Pipeline</h2>
      <DashboardGrid>
        <StatsCard title="New Leads" value={summary.newLeads} icon={Target} />
        <StatsCard
          title="Qualified Leads"
          value={summary.qualifiedLeads}
          icon={BadgeCheck}
        />
        <StatsCard title="Won Deals" value={summary.wonDeals} icon={Trophy} />
        <StatsCard title="Lost Deals" value={summary.lostDeals} icon={XCircle} />
        <StatsCard
          title="Conversion Rate"
          value={`${summary.conversionRate}%`}
          icon={Percent}
        />
        <StatsCard
          title="Pipeline Value"
          value={`$${summary.pipelineValue.toLocaleString()}`}
          icon={DollarSign}
        />
      </DashboardGrid>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tasks by status</CardTitle>
          </CardHeader>
          <CardContent>
            <TasksByStatusChart data={summary.taskStatusCounts} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Projects created per month</CardTitle>
          </CardHeader>
          <CardContent>
            <ProjectsPerMonthChart data={summary.projectsCreatedPerMonth} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Activity trend (14 days)</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityTrendChart data={summary.activityTrend} />
          </CardContent>
        </Card>
      </div>

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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent tasks</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {summary.recentTasks.length === 0 && (
              <p className="text-sm text-slate-500">No tasks yet.</p>
            )}
            {summary.recentTasks.map((task) => (
              <div key={task.id} className="flex items-center justify-between text-sm">
                <Link
                  href={`/projects/${task.project.id}/tasks/${task.id}`}
                  className="hover:underline"
                >
                  {task.title}
                </Link>
                <span className="text-slate-500">
                  {task.assignee
                    ? `${task.assignee.firstName} ${task.assignee.lastName}`
                    : "Unassigned"}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent uploads</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {summary.recentUploads.length === 0 && (
              <p className="text-sm text-slate-500">No files yet.</p>
            )}
            {summary.recentUploads.map((file) => (
              <a
                key={file.id}
                href={`/api/files/${file.id}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between text-sm hover:underline"
              >
                <span className="truncate">{file.fileName}</span>
                <span className="text-slate-500">
                  {file.uploadedBy.firstName} {file.uploadedBy.lastName}
                </span>
              </a>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent comments</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {summary.recentComments.length === 0 && (
              <p className="text-sm text-slate-500">No comments yet.</p>
            )}
            {summary.recentComments.map((note) => (
              <div key={note.id} className="text-sm">
                <p className="truncate">{note.body}</p>
                <p className="text-xs text-slate-500">
                  {note.author.firstName} {note.author.lastName}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recently added users</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {summary.recentUsers.length === 0 && (
              <p className="text-sm text-slate-500">No users yet.</p>
            )}
            {summary.recentUsers.map((recentUser) => (
              <Link
                key={recentUser.id}
                href={`/users/${recentUser.id}`}
                className="flex items-center justify-between text-sm hover:underline"
              >
                <span>
                  {recentUser.firstName} {recentUser.lastName}
                </span>
                <span className="text-slate-500">
                  {formatEnumLabel(recentUser.role)}
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
