import { notFound } from "next/navigation";

import ContentDetail from "@/features/content-workspace/components/ContentDetail";
import { isUuid } from "@/lib/utils";

/**
 * The long-standing project-scoped address for a content record.
 *
 * PRESERVED EXACTLY: every existing link, bookmark and revalidatePath still
 * resolves here, and the project in the URL is still checked against the
 * record's own project, so a mismatched pair is still a clean not-found.
 *
 * The view itself lives in ContentDetail, which the client-first
 * `/content/[contentId]` address renders too — one detail system, two
 * addresses, because a record with no project cannot have this one.
 */
type ContentDetailPageProps = {
  params: Promise<{ id: string; contentId: string }>;
};

export default async function ProjectContentDetailPage({ params }: ContentDetailPageProps) {
  const { id: seoProjectId, contentId } = await params;
  if (!isUuid(contentId) || !isUuid(seoProjectId)) notFound();
  return <ContentDetail contentId={contentId} expectedSeoProjectId={seoProjectId} />;
}
