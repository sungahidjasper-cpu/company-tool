/**
 * Where a content record lives, now that the SEO project is optional.
 *
 * Content used to be reachable at exactly one address — `/seo/[project]/content/[id]`
 * — because every row had a project. A client-owned row has no project to put
 * in that path, so it needs its own address; and every existing row still has
 * a project, so its existing address must keep working.
 *
 * Both facts are resolved here, in one place, so no call site has to decide.
 * Pure: no I/O, no Prisma, safe on the server and in the browser.
 */

export type ContentLocation = {
  id: string;
  seoProjectId: string | null;
};

/**
 * The canonical link to a content record.
 *
 * Project content keeps its long-standing SEO address, so every existing link,
 * bookmark and revalidatePath call continues to resolve exactly as before.
 * Client-owned content gets the project-free address.
 */
export function contentDetailHref(content: ContentLocation): string {
  return content.seoProjectId ? `/seo/${content.seoProjectId}/content/${content.id}` : `/content/${content.id}`;
}

/**
 * Every path whose cache should be dropped when a content record changes.
 *
 * A record with a project touches the project's listing too; one without has
 * only its own page and the workspace. The workspace is always included
 * because it is the client-first view that now shows both kinds.
 */
export function contentRevalidatePaths(content: ContentLocation): string[] {
  const paths = ["/content", `/content/${content.id}`];
  if (content.seoProjectId) {
    paths.push(`/seo/${content.seoProjectId}`, `/seo/${content.seoProjectId}/content`, `/seo/${content.seoProjectId}/content/${content.id}`);
  }
  return paths;
}
