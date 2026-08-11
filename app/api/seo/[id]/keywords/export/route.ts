import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { toCsv } from "@/lib/csv";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type RouteParams = { params: Promise<{ id: string }> };

/** Ad-hoc download, not a persisted Report record — see the Phase 10 report for why. */
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

  const keywords = await prisma.keyword.findMany({
    where: { seoProjectId, deletedAt: null },
    orderBy: { term: "asc" },
    include: { cluster: { select: { name: true } } },
  });

  const columns = [
    "term",
    "cluster",
    "searchVolume",
    "difficulty",
    "currentRank",
    "targetUrl",
    "intent",
    "priority",
    "status",
  ];
  const rows = keywords.map((keyword) => [
    keyword.term,
    keyword.cluster?.name ?? "",
    keyword.searchVolume ?? "",
    keyword.difficulty ?? "",
    keyword.currentRank ?? "",
    keyword.targetUrl ?? "",
    keyword.intent ?? "",
    keyword.priority,
    keyword.status,
  ]);

  const csv = toCsv(columns, rows);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${seoProject.name}-keywords.csv"`,
    },
  });
}
