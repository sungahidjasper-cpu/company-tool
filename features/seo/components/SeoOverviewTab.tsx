import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import CategoryScoreBar from "@/features/seo/components/CategoryScoreBar";
import SeoScoreGauge from "@/features/seo/components/SeoScoreGauge";
import type { SeoAuditResultData } from "@/features/seo/schemas/seo-audit.schema";

type SeoOverviewTabProps = {
  overallScore: number;
  categoryScores: SeoAuditResultData["categoryScores"];
  executiveSummary: SeoAuditResultData["executiveSummary"];
};

export default function SeoOverviewTab({ overallScore, categoryScores, executiveSummary }: SeoOverviewTabProps) {
  const miniScores: { label: string; score: number | null }[] = [
    { label: "Technical", score: categoryScores.technicalSeo.score },
    { label: "On-Page", score: categoryScores.onPageSeo.score },
    { label: "Content", score: categoryScores.contentQuality?.score ?? null },
    { label: "Structured Data", score: categoryScores.structuredData.score },
    { label: "Internal Linking", score: categoryScores.internalLinking.score },
    { label: "EEAT", score: categoryScores.eeat?.score ?? null },
    ...(categoryScores.localSeo?.applicable && categoryScores.localSeo.score !== null
      ? [{ label: "Local SEO", score: categoryScores.localSeo.score }]
      : []),
    { label: "GEO Readiness", score: categoryScores.geoReadiness?.score ?? null },
    { label: "AEO Readiness", score: categoryScores.aeoReadiness?.score ?? null },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="flex flex-col items-center gap-6 py-6 md:flex-row md:items-start">
          <SeoScoreGauge score={overallScore} label="Overall SEO health" />
          <p className="text-sm text-slate-600 md:flex-1">
            {executiveSummary?.overallHealthNarrative ?? "The AI executive summary is unavailable for this run — deterministic scores and findings below are unaffected."}
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {miniScores.map((item) => (
          <CategoryScoreBar key={item.label} label={item.label} score={item.score} />
        ))}
      </div>

      {executiveSummary && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Strengths</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="list-inside list-disc space-y-1 text-sm text-slate-600">
                  {executiveSummary.strengths.map((strength) => (
                    <li key={strength}>{strength}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Weaknesses</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="list-inside list-disc space-y-1 text-sm text-slate-600">
                  {executiveSummary.weaknesses.map((weakness) => (
                    <li key={weakness}>{weakness}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top recommended actions</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="list-inside list-decimal space-y-1 text-sm text-slate-600">
                {executiveSummary.topActions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
