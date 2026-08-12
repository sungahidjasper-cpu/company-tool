import { ArrowDown, ArrowUp, Minus } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { parseWebsiteAnalysisResult } from "@/features/seo/schemas/seo-audit.schema";
import type { WebsiteAnalysisJob } from "@/lib/generated/prisma/client";

type AnalysisCompareViewProps = {
  jobA: WebsiteAnalysisJob;
  jobB: WebsiteAnalysisJob;
};

const CATEGORY_LABELS: { key: string; label: string }[] = [
  { key: "technicalSeo", label: "Technical SEO" },
  { key: "onPageSeo", label: "On-Page SEO" },
  { key: "contentQuality", label: "Content Quality" },
  { key: "structuredData", label: "Structured Data" },
  { key: "internalLinking", label: "Internal Linking" },
  { key: "eeat", label: "EEAT" },
  { key: "localSeo", label: "Local SEO" },
  { key: "geoReadiness", label: "GEO Readiness" },
  { key: "aeoReadiness", label: "AEO Readiness" },
];

function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) {
    return (
      <span className="flex items-center gap-1 text-xs text-slate-400">
        <Minus size={12} /> No change
      </span>
    );
  }
  const isUp = delta > 0;
  return (
    <span className={`flex items-center gap-1 text-xs font-medium ${isUp ? "text-emerald-600" : "text-destructive"}`}>
      {isUp ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
      {Math.abs(delta)} pts
    </span>
  );
}

export default function AnalysisCompareView({ jobA, jobB }: AnalysisCompareViewProps) {
  const resultA = parseWebsiteAnalysisResult(jobA);
  const resultB = parseWebsiteAnalysisResult(jobB);

  if (!resultA?.audit || !resultB?.audit) {
    return (
      <Card>
        <CardContent>
          <p className="text-sm text-slate-500">
            One or both of these analyses ran before SEO scoring was added and can&apos;t be compared. Re-run them to
            generate comparable scores.
          </p>
        </CardContent>
      </Card>
    );
  }

  const categoryScores = CATEGORY_LABELS.map(({ key, label }) => {
    const scoreA = (resultA.audit!.categoryScores as Record<string, { score: number | null }>)[key]?.score ?? null;
    const scoreB = (resultB.audit!.categoryScores as Record<string, { score: number | null }>)[key]?.score ?? null;
    return { label, scoreA, scoreB };
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{new Date(jobA.createdAt).toLocaleString()}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{resultA.audit.overallScore}/100</p>
            <p className="text-sm text-slate-500">{jobA.domain}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{new Date(jobB.createdAt).toLocaleString()}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{resultB.audit.overallScore}/100</p>
            <p className="text-sm text-slate-500">{jobB.domain}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Category scores</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {categoryScores.map(({ label, scoreA, scoreB }) => (
            <div key={label} className="flex items-center justify-between gap-4 text-sm">
              <span className="w-40 shrink-0 font-medium">{label}</span>
              <span className="w-16 text-right text-slate-600">{scoreA ?? "—"}</span>
              <span className="text-slate-400">→</span>
              <span className="w-16 text-slate-600">{scoreB ?? "—"}</span>
              {scoreA !== null && scoreB !== null && <DeltaBadge delta={scoreB - scoreA} />}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
