import { prisma } from "@/lib/prisma";
import { buildEntityWhere } from "@/features/files/services/entity-target";
import type { FileEntityType } from "@/features/files/schemas/file.schema";

export function listFilesFor(entityType: FileEntityType, entityId: string) {
  return prisma.file.findMany({
    where: { ...buildEntityWhere(entityType, entityId), deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: {
      uploadedBy: { select: { firstName: true, lastName: true } },
    },
  });
}
