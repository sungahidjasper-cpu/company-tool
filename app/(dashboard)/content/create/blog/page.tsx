import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import BlogStudio from "@/features/blog/components/BlogStudio";
import { listCompanyTags } from "@/features/blog/services/blog-settings.queries";
import { formatScheduledFor, instantToZonedParts, isValidTimeZone, zonedWallTimeToInstant } from "@/features/content-workspace/services/content-scheduling";
import { buildWorkspaceHref } from "@/features/content-workspace/services/workspace-context";
import { getContentById } from "@/features/seo/services/content.service";
import { listKeywordOptions } from "@/features/seo/services/keyword.service";
import { listUserOptions } from "@/features/users/services/user.service";
import { requireUser } from "@/lib/auth";
import { assertPermission, Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { isUuid } from "@/lib/utils";

/**
 * Phase 7 — the Blog Content Studio route.
 *
 * Reached from the calendar's creation workflow with the chosen date, time
 * and zone. `?contentId=` reopens a saved article. Those parameters are
 * preselection only: the project and the record are both resolved through the
 * actor's own company, and saveBlogPostAction re-derives all of it again.
 *
 * A social post is deliberately not editable here — it has its own composer,
 * and opening one in an article editor would present a caption as a body.
 */
type BlogStudioPageProps = {
  searchParams: Promise<{ date?: string; time?: string; tz?: string; client?: string; project?: string; contentId?: string }>;
};

export default async function BlogStudioPage({ searchParams }: BlogStudioPageProps) {
  const user = await requireUser();
  assertPermission(user, Permissions.manageSeoProjects);

  const query = await searchParams;

  const existingContent = query.contentId && isUuid(query.contentId) ? await getContentById(query.contentId) : null;
  if (query.contentId && (!existingContent || existingContent.companyId !== user.companyId || existingContent.deletedAt !== null || existingContent.socialPost !== null)) {
    notFound();
  }

  /*
   * CLIENT-FIRST. An article belongs to a client; the SEO project is optional
   * context that supplies keywords and the site domain. Without one there are
   * simply no keywords to offer and no domain to preview against — which the
   * studio states, rather than the page refusing to open.
   */
  const seoProjectId = existingContent?.seoProjectId ?? (query.project && isUuid(query.project) ? query.project : null);

  const project = seoProjectId
    ? await prisma.sEOProject.findUnique({
        where: { id: seoProjectId },
        select: { id: true, name: true, domain: true, companyId: true, clientId: true, deletedAt: true, client: { select: { id: true, name: true } } },
      })
    : null;
  if (seoProjectId && (!project || project.companyId !== user.companyId)) notFound();

  /*
   * The URL's OWN client wins over the project's, so a URL naming both a
   * client and a project that disagree is REFUSED below rather than silently
   * resolved to the project's client. Preferring the project quietly gave the
   * user a different client than the one they asked for.
   */
  const requestedClientId = query.client && isUuid(query.client) ? query.client : null;
  const clientId = existingContent?.clientId ?? requestedClientId ?? project?.clientId ?? null;
  if (!clientId) notFound();

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, companyId: true, deletedAt: true },
  });
  if (!client || client.companyId !== user.companyId || client.deletedAt !== null) notFound();
  if (project && project.clientId !== client.id) notFound();

  const [authorOptions, keywordOptions, tagOptions] = await Promise.all([
    listUserOptions(user.companyId),
    // Keywords belong to a project; with no project there are none to offer.
    project ? listKeywordOptions(project.id) : Promise.resolve([]),
    listCompanyTags(user.companyId),
  ]);

  const savedParts =
    existingContent?.scheduledAt && existingContent.scheduledTimezone
      ? instantToZonedParts(existingContent.scheduledAt, existingContent.scheduledTimezone)
      : null;

  const handoffValid = query.date && query.time && query.tz && isValidTimeZone(query.tz) && zonedWallTimeToInstant(query.date, query.time, query.tz) !== null;

  const initialDateIso = savedParts?.dateIso ?? (handoffValid ? query.date! : "");
  const initialTime = savedParts?.time ?? (handoffValid ? query.time! : "09:00");
  const initialTimeZone = existingContent?.scheduledTimezone ?? (handoffValid ? query.tz! : null);

  const intendedLabel =
    initialDateIso && initialTimeZone
      ? (() => {
          const instant = zonedWallTimeToInstant(initialDateIso, initialTime, initialTimeZone);
          return instant ? formatScheduledFor(instant, initialTimeZone) : null;
        })()
      : null;

  const backHref = buildWorkspaceHref(
    { clientId: client.id, projectId: project?.id ?? "" },
    "MONTH",
    initialDateIso || undefined
  );

  return (
    <PageContainer>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
        <Link href={backHref} className="inline-flex items-center gap-1 font-medium text-slate-600 hover:underline">
          <ArrowLeft size={14} /> Content workspace
        </Link>
        <span aria-hidden="true">/</span>
        <Link href={`/clients/${client.id}`} className="hover:underline">
          {client.name}
        </Link>
        {/* The SEO project appears in the trail only when there IS one. */}
        {project && (
          <>
            <span aria-hidden="true">/</span>
            <Link href={`/seo/${project.id}`} className="hover:underline">
              {project.name}
            </Link>
          </>
        )}
        <span aria-hidden="true">/</span>
        <span>{existingContent ? "Edit article" : "New article"}</span>
      </div>

      <DashboardHeader
        title="Blog post"
        description={intendedLabel ? `Intended for ${intendedLabel}. Nothing is scheduled until you choose Schedule.` : "Write the article, then choose when it should go out."}
      />

      <BlogStudio
        clientId={client.id}
        clientName={client.name}
        seoProjectId={project?.id ?? null}
        seoProjectName={project?.name ?? null}
        siteDomain={project?.domain ?? null}
        authorOptions={authorOptions.map((option) => ({ id: option.id, label: `${option.firstName} ${option.lastName}` }))}
        keywordOptions={keywordOptions.map((option) => ({ id: option.id, label: option.term }))}
        tagOptions={tagOptions.map((option) => ({ id: option.id, label: option.name }))}
        initialDateIso={initialDateIso}
        initialTime={initialTime}
        initialTimeZone={initialTimeZone}
        existing={
          existingContent
            ? {
                contentId: existingContent.id,
                title: existingContent.title,
                body: existingContent.body ?? "",
                metaTitle: existingContent.metaTitle ?? "",
                metaDescription: existingContent.metaDescription ?? "",
                url: existingContent.url ?? "",
                authorId: existingContent.authorId ?? "",
                keywordIds: existingContent.keywords.map((keyword) => keyword.id),
                tagIds: existingContent.tags.map((tag) => tag.id),
                status: existingContent.status,
              }
            : undefined
        }
        backHref={backHref}
      />
    </PageContainer>
  );
}
