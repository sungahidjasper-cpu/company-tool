import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { storage } from "@/lib/storage";
import {
  getEntityIdFromFile,
  resolveEntityContext,
  resolveEntityTypeFromFile,
} from "@/features/files/services/entity-target";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const file = await prisma.file.findUnique({ where: { id } });
  if (!file) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const entityType = resolveEntityTypeFromFile(file);
  if (!entityType) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const entityId = getEntityIdFromFile(file, entityType);

  const context = await resolveEntityContext(entityType, entityId, user.id);
  if (!context || context.companyId !== user.companyId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Providers with native signed/public URLs redirect here instead of
  // proxying bytes — local storage always falls through to the read below.
  const signedUrl = await storage.getSignedUrl(file.url);
  if (signedUrl) {
    return NextResponse.redirect(signedUrl);
  }

  const buffer = await storage.read(file.url);
  const isDownload = request.nextUrl.searchParams.get("download") === "1";
  const body = new Uint8Array(buffer);

  return new NextResponse(body, {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.sizeBytes),
      "Content-Disposition": `${isDownload ? "attachment" : "inline"}; filename="${encodeURIComponent(file.fileName)}"`,
    },
  });
}
