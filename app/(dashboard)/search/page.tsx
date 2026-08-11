import Link from "next/link";
import { Search } from "lucide-react";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EmptyState from "@/components/dashboard/EmptyState";
import PageContainer from "@/components/dashboard/PageContainer";
import SearchInput from "@/components/dashboard/SearchInput";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { globalSearch } from "@/features/search/services/search.service";
import { requireUser } from "@/lib/auth";

type SearchPageProps = {
  searchParams: Promise<{ q?: string }>;
};

function ResultSection({
  title,
  children,
  isEmpty,
}: {
  title: string;
  children: React.ReactNode;
  isEmpty: boolean;
}) {
  if (isEmpty) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">{children}</CardContent>
    </Card>
  );
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const user = await requireUser();
  const { q = "" } = await searchParams;

  const results = await globalSearch(q, user);

  const totalResults =
    results.companies.length +
    results.users.length +
    results.clients.length +
    results.leads.length +
    results.projects.length +
    results.tasks.length +
    results.files.length +
    results.reports.length +
    results.seoProjects.length +
    results.keywords.length +
    results.content.length;

  return (
    <PageContainer>
      <DashboardHeader
        title="Search"
        description={q ? `Results for "${q}"` : "Search across your workspace"}
      />

      <SearchInput
        action="/search"
        defaultValue={q}
        placeholder="Search companies, clients, leads, projects, tasks, users, files, reports, SEO..."
      />

      {q.trim().length < 2 ? (
        <EmptyState
          icon={Search}
          title="Type at least 2 characters"
          description="Search across companies, clients, leads, projects, tasks, users, files, reports, SEO projects, keywords, and content."
        />
      ) : totalResults === 0 ? (
        <EmptyState
          icon={Search}
          title="No results found"
          description={`Nothing matched "${q}". Try a different search term.`}
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ResultSection title="Companies" isEmpty={results.companies.length === 0}>
            {results.companies.map((company) => (
              <Link
                key={company.id}
                href={`/companies/${company.id}`}
                className="text-sm hover:underline"
              >
                {company.name}
              </Link>
            ))}
          </ResultSection>

          <ResultSection title="Users" isEmpty={results.users.length === 0}>
            {results.users.map((result) => (
              <Link
                key={result.id}
                href={`/users/${result.id}`}
                className="text-sm hover:underline"
              >
                {result.firstName} {result.lastName}
              </Link>
            ))}
          </ResultSection>

          <ResultSection title="Clients" isEmpty={results.clients.length === 0}>
            {results.clients.map((client) => (
              <Link
                key={client.id}
                href={`/clients/${client.id}`}
                className="text-sm hover:underline"
              >
                {client.name}
              </Link>
            ))}
          </ResultSection>

          <ResultSection title="Leads" isEmpty={results.leads.length === 0}>
            {results.leads.map((lead) => (
              <Link
                key={lead.id}
                href={`/leads/${lead.id}`}
                className="text-sm hover:underline"
              >
                {lead.name}
                {lead.companyName ? ` · ${lead.companyName}` : ""}
              </Link>
            ))}
          </ResultSection>

          <ResultSection title="Projects" isEmpty={results.projects.length === 0}>
            {results.projects.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="text-sm hover:underline"
              >
                {project.name}
              </Link>
            ))}
          </ResultSection>

          <ResultSection title="Tasks" isEmpty={results.tasks.length === 0}>
            {results.tasks.map((task) => (
              <Link
                key={task.id}
                href={`/projects/${task.projectId}/tasks/${task.id}`}
                className="text-sm hover:underline"
              >
                {task.title}
              </Link>
            ))}
          </ResultSection>

          <ResultSection title="Files" isEmpty={results.files.length === 0}>
            {results.files.map((file) => (
              <a
                key={file.id}
                href={`/api/files/${file.id}`}
                target="_blank"
                rel="noreferrer"
                className="text-sm hover:underline"
              >
                {file.fileName}
              </a>
            ))}
          </ResultSection>

          <ResultSection title="Reports" isEmpty={results.reports.length === 0}>
            {results.reports.map((report) => (
              <Link
                key={report.id}
                href={`/reports/${report.id}`}
                className="text-sm hover:underline"
              >
                {report.title}
              </Link>
            ))}
          </ResultSection>

          <ResultSection title="SEO Projects" isEmpty={results.seoProjects.length === 0}>
            {results.seoProjects.map((seoProject) => (
              <Link
                key={seoProject.id}
                href={`/seo/${seoProject.id}`}
                className="text-sm hover:underline"
              >
                {seoProject.name}
                {seoProject.domain ? ` · ${seoProject.domain}` : ""}
              </Link>
            ))}
          </ResultSection>

          <ResultSection title="Keywords" isEmpty={results.keywords.length === 0}>
            {results.keywords.map((keyword) => (
              <Link
                key={keyword.id}
                href={`/seo/${keyword.seoProjectId}/keywords/${keyword.id}`}
                className="text-sm hover:underline"
              >
                {keyword.term}
              </Link>
            ))}
          </ResultSection>

          <ResultSection title="Content" isEmpty={results.content.length === 0}>
            {results.content.map((item) => (
              <Link
                key={item.id}
                href={`/seo/${item.seoProjectId}/content/${item.id}`}
                className="text-sm hover:underline"
              >
                {item.title}
              </Link>
            ))}
          </ResultSection>
        </div>
      )}
    </PageContainer>
  );
}
