import { notFound } from "next/navigation";

import ContentDetail from "@/features/content-workspace/components/ContentDetail";
import { isUuid } from "@/lib/utils";

/**
 * The client-first address for a content record.
 *
 * A record that belongs to a client but no SEO project has no project id to
 * put in a URL, so this is the only address it can have. It renders the SAME
 * ContentDetail as the project-scoped route — the address changed, not the
 * view — and asserts no project, so it works for both kinds of record.
 *
 * Ownership is still resolved inside ContentDetail from the authenticated
 * actor's company; the id in this URL grants nothing on its own.
 */
type ClientContentDetailPageProps = {
  params: Promise<{ contentId: string }>;
};

export default async function ClientContentDetailPage({ params }: ClientContentDetailPageProps) {
  const { contentId } = await params;
  if (!isUuid(contentId)) notFound();
  return <ContentDetail contentId={contentId} />;
}
