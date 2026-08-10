import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { storage } from "@/lib/storage";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * Report↔File isn't part of the polymorphic entity-target system in
 * features/files/ (Report references File via fileId, not the other way
 * around like Client/Project/Task/Lead do) — so this is a small dedicated
 * route rather than a case added to app/api/files/[id]/route.ts.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const report = await prisma.report.findUnique({ where: { id } });
  if (!report || report.companyId !== user.companyId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!report.fileId) {
    return NextResponse.json({ error: "This report has no file." }, { status: 404 });
  }

  const file = await prisma.file.findUnique({ where: { id: report.fileId } });
  if (!file) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

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
