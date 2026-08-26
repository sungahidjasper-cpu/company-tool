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

// Mirrors search.service.ts's RESULT_LIMIT — a category returning exactly
// this many results means more may exist beyond the cap, since no COUNT
// query is run to know the real total.
const POSSIBLY_TRUNCATED_AT = 8;

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

function seeAllHref(base: string, q: string) {
  const sp = new URLSearchParams({ q });
  return `${base}?${sp.toString()}`;
}

function SeeAllLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="text-sm font-medium text-[var(--primary)] hover:underline"
    >
      See all results in {label} →
    </Link>
  );
}

function TruncationNote() {
  return (
    <p className="text-xs text-slate-500">
      Showing the first 8 — refine your search to narrow results.
    </p>
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
            {results.companies.length === POSSIBLY_TRUNCATED_AT && (
              <SeeAllLink href={seeAllHref("/companies", results.query)} label="Companies" />
            )}
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
            {results.users.length === POSSIBLY_TRUNCATED_AT && (
              <SeeAllLink href={seeAllHref("/users", results.query)} label="Users" />
            )}
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
            {results.clients.length === POSSIBLY_TRUNCATED_AT && (
              <SeeAllLink href={seeAllHref("/clients", results.query)} label="Clients" />
            )}
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
            {results.leads.length === POSSIBLY_TRUNCATED_AT && (
              <SeeAllLink href={seeAllHref("/leads", results.query)} label="Leads" />
            )}
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
            {results.projects.length === POSSIBLY_TRUNCATED_AT && (
              <SeeAllLink href={seeAllHref("/projects", results.query)} label="Projects" />
            )}
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
            {results.tasks.length === POSSIBLY_TRUNCATED_AT && <TruncationNote />}
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
            {results.reports.length === POSSIBLY_TRUNCATED_AT && (
              <SeeAllLink href={seeAllHref("/reports", results.query)} label="Reports" />
            )}
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
            {results.seoProjects.length === POSSIBLY_TRUNCATED_AT && (
              <SeeAllLink href={seeAllHref("/seo", results.query)} label="SEO Projects" />
            )}
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
            {results.keywords.length === POSSIBLY_TRUNCATED_AT && <TruncationNote />}
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
            {results.content.length === POSSIBLY_TRUNCATED_AT && <TruncationNote />}
          </ResultSection>
        </div>
      )}
    </PageContainer>
  );
}
