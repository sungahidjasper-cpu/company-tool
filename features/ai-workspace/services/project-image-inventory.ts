import { prisma } from "@/lib/prisma";
import { IMAGE_MIME_TYPES } from "@/features/files/schemas/file.schema";

/**
 * The image inventory for ONE SEO project.
 *
 * A File is attached to exactly one target (see buildEntityWhere): a file
 * uploaded against an SEO project carries `seoProjectId`, while one uploaded
 * against a Content record carries `contentId` and leaves `seoProjectId`
 * null. Both belong to the project from the user's point of view, so the
 * inventory is the union of the two — resolved through the Content relation
 * for the second, never by trusting a client-supplied association.
 *
 * Every branch is scoped by the ALREADY-VERIFIED project id, so ownership is
 * inherited from the caller's own project check rather than re-derived from
 * anything the client sent. Soft-deleted files, and files whose Content has
 * been trashed, are excluded.
 */
export const PROJECT_IMAGE_WHERE = (seoProjectId: string) => ({
  deletedAt: null,
  mimeType: { in: [...IMAGE_MIME_TYPES] },
  OR: [{ seoProjectId }, { content: { seoProjectId, deletedAt: null } }],
});

export type ProjectImage = {
  id: string;
  fileName: string;
  mimeType: string;
  /** The Content this image is attached to, when it is attached to one. */
  contentId: string | null;
  contentTitle: string | null;
};

/**
 * Lists the project's images for the picker. Deliberately returns no URL,
 * storage key, size or uploader: the picker needs a label and an id, and the
 * storage key is an internal detail with no business appearing in a form.
 */
export async function listProjectImages(seoProjectId: string): Promise<ProjectImage[]> {
  const files = await prisma.file.findMany({
    where: PROJECT_IMAGE_WHERE(seoProjectId),
    select: { id: true, fileName: true, mimeType: true, contentId: true, content: { select: { title: true } } },
    orderBy: { fileName: "asc" },
  });

  return files.map((file) => ({
    id: file.id,
    fileName: file.fileName,
    mimeType: file.mimeType,
    contentId: file.contentId,
    contentTitle: file.content?.title ?? null,
  }));
}

/**
 * Re-reads ONE image, scoped to the already-verified project, and returns
 * null when it is not an image of this project's — which covers a file that
 * does not exist, a non-image file, a soft-deleted file, a file of another
 * project, a file of another company, and a file whose Content has been
 * trashed. The caller reports all of these identically, so the response never
 * discloses which case applied.
 */
export async function getProjectImage(fileId: string, seoProjectId: string) {
  return prisma.file.findFirst({
    where: { id: fileId, ...PROJECT_IMAGE_WHERE(seoProjectId) },
    select: {
      id: true,
      fileName: true,
      mimeType: true,
      contentId: true,
      content: { select: { title: true, metaDescription: true, seoProjectId: true, deletedAt: true } },
    },
  });
}
