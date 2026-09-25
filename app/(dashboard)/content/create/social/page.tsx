import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import { formatScheduledFor, instantToZonedParts, isValidTimeZone, zonedWallTimeToInstant } from "@/features/content-workspace/services/content-scheduling";
import { buildWorkspaceHref } from "@/features/content-workspace/services/workspace-context";
import { listFilesFor } from "@/features/files/services/file.service";
import SocialComposer, { type ComposerAccount } from "@/features/social/components/SocialComposer";
import { getSocialPostForContent, listConnectedAccounts } from "@/features/social/services/social-account.queries";
import { requireUser } from "@/lib/auth";
import { assertPermission, Permissions } from "@/lib/authorization";
import type { SocialPlatform } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { isUuid } from "@/lib/utils";

/**
 * Phase 6 — the Social Composer route.
 *
 * Reached from the calendar's creation workflow, carrying the date, time and
 * zone the user chose. Those are preselection context, not authority: the
 * project is resolved through the actor's own company, and the save action
 * re-derives every one of those checks independently.
 *
 * `?contentId=` reopens a saved post. A record that is not this company's, or
 * not a social post, is a plain not-found.
 */
type SocialComposerPageProps = {
  searchParams: Promise<{ date?: string; time?: string; tz?: string; client?: string; project?: string; contentId?: string }>;
};

export default async function SocialComposerPage({ searchParams }: SocialComposerPageProps) {
  const user = await requireUser();
  assertPermission(user, Permissions.manageSeoProjects);

  const query = await searchParams;

  // Reopening a saved post takes its own project; otherwise the URL names one.
  const saved = query.contentId && isUuid(query.contentId) ? await getSocialPostForContent(query.contentId, user.companyId) : null;
  if (query.contentId && !saved) notFound();

  /*
   * CLIENT-FIRST. A social post targets a client's own social accounts, so
   * the client is what it needs — an SEO project was only ever required
   * because Content could not exist without one.
   *
   * The project is still accepted and still carried through, so arriving from
   * a project-scoped calendar keeps that context; it is simply optional.
   */
  const seoProjectId = saved?.content.seoProjectId ?? (query.project && isUuid(query.project) ? query.project : null);

  const project = seoProjectId
    ? await prisma.sEOProject.findUnique({
        where: { id: seoProjectId },
        select: { id: true, name: true, companyId: true, clientId: true, client: { select: { id: true, name: true } } },
      })
    : null;
  if (seoProjectId && (!project || project.companyId !== user.companyId)) notFound();

  // The client comes from the saved post, then the project, then the URL.
  /*
   * The URL's OWN client wins over the project's, so a URL naming both a
   * client and a project that disagree is REFUSED below rather than silently
   * resolved to the project's client. Preferring the project quietly gave the
   * user a different client than the one they asked for.
   */
  const requestedClientId = query.client && isUuid(query.client) ? query.client : null;
  const clientId = saved?.content.clientId ?? requestedClientId ?? project?.clientId ?? null;
  if (!clientId) notFound();

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, companyId: true, deletedAt: true },
  });
  if (!client || client.companyId !== user.companyId || client.deletedAt !== null) notFound();
  // A project may only ever be paired with its own client.
  if (project && project.clientId !== client.id) notFound();

  const accounts: ComposerAccount[] = (await listConnectedAccounts(user.companyId, client.id)).map((account) => ({
    id: account.id,
    platform: account.platform as SocialPlatform,
    handle: account.handle,
    displayName: account.displayName,
    /* Passed through, never assumed — the composer states it rather than guessing. */
    connectionState: account.connectionState,
  }));

  /*
   * The intended moment: a saved post's own schedule wins, then the calendar
   * hand-off, then a plain default. The date the user clicked is never
   * silently replaced by today.
   */
  const savedParts =
    saved?.content.scheduledAt && saved.content.scheduledTimezone
      ? instantToZonedParts(saved.content.scheduledAt, saved.content.scheduledTimezone)
      : null;

  const handoffValid = query.date && query.time && query.tz && isValidTimeZone(query.tz) && zonedWallTimeToInstant(query.date, query.time, query.tz) !== null;

  /*
   * A saved DRAFT deliberately stores no scheduled instant — that field
   * belongs to SCHEDULED records alone — so reopening one has nothing to
   * restore, and this is left empty. The composer fills in a plainly editable
   * default in that case; the fallback lives there rather than here because
   * deriving it from the clock is not something a render may do.
   */
  const initialDateIso = savedParts?.dateIso ?? (handoffValid ? query.date! : "");
  const initialTime = savedParts?.time ?? (handoffValid ? query.time! : "09:00");
  const initialTimeZone = saved?.content.scheduledTimezone ?? (handoffValid ? query.tz! : null);

  const files = saved
    ? (await listFilesFor("content", saved.content.id)).map((file) => ({
        id: file.id,
        fileName: file.fileName,
        url: `/api/files/${file.id}`,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
      }))
    : [];

  const intendedLabel =
    initialDateIso && initialTimeZone
      ? (() => {
          const instant = zonedWallTimeToInstant(initialDateIso, initialTime, initialTimeZone);
          return instant ? formatScheduledFor(instant, initialTimeZone) : null;
        })()
      : null;

  const isScheduled = saved?.content.status === "SCHEDULED";

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
        <span>{saved ? "Edit social post" : "New social post"}</span>
      </div>

      <DashboardHeader
        title="Social post"
        /*
         * The header must agree with the composer beneath it. A post that is
         * already SCHEDULED was being described as "Nothing is scheduled until
         * you choose Schedule" — false, and directly contradicted by the
         * context bar two lines below reading "Scheduled for". The status is
         * the only thing that decides which sentence is true.
         */
        description={
          isScheduled
            ? `Scheduled for ${intendedLabel}. Scheduled in Cloud Compass only — no platform is contacted.`
            : intendedLabel
              ? `Intended for ${intendedLabel}. Nothing is scheduled until you choose Schedule.`
              : "Choose when this post is intended to go out."
        }
      />

      <SocialComposer
        clientId={client.id}
        clientName={client.name}
        seoProjectId={project?.id ?? null}
        seoProjectName={project?.name ?? null}
        accounts={accounts}
        initialDateIso={initialDateIso}
        initialTime={initialTime}
        initialTimeZone={initialTimeZone}
        existing={
          saved
            ? {
                contentId: saved.content.id,
                caption: saved.caption,
                link: saved.link ?? "",
                firstComment: saved.firstComment ?? "",
                /*
                 * caption/link/firstComment come back exactly as stored: null
                 * means this account was following the shared value, a
                 * string means it had its own. Reopening therefore restores
                 * each platform tab in the state it was left in.
                 */
                targets: saved.targets.map((target) => ({
                  id: target.id,
                  accountId: target.socialAccountId,
                  caption: target.caption,
                  link: target.link,
                  firstComment: target.firstComment,
                  publication: target.publication,
                  comment: target.comment,
                })),
                status: saved.content.status,
                files,
              }
            : undefined
        }
        backHref={backHref}
      />
    </PageContainer>
  );
}
