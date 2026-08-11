import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { toCsv } from "@/lib/csv";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: seoProjectId } = await params;
  const seoProject = await prisma.sEOProject.findUnique({ where: { id: seoProjectId } });
  if (!seoProject || seoProject.companyId !== user.companyId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const content = await prisma.content.findMany({
    where: { seoProjectId, deletedAt: null },
    orderBy: { title: "asc" },
  });

  const columns = ["title", "url", "status", "publishedAt"];
  const rows = content.map((item) => [
    item.title,
    item.url ?? "",
    item.status,
    item.publishedAt ? item.publishedAt.toISOString().slice(0, 10) : "",
  ]);

  const csv = toCsv(columns, rows);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${seoProject.name}-content.csv"`,
    },
  });
}
