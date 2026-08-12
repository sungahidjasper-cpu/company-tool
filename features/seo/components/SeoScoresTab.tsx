import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import CategoryScoreBar from "@/features/seo/components/CategoryScoreBar";
import type { SeoAuditResultData } from "@/features/seo/schemas/seo-audit.schema";
import { formatEnumLabel } from "@/lib/utils";

type SeoScoresTabProps = {
  categoryScores: SeoAuditResultData["categoryScores"];
  internalLinkingSuggestions: SeoAuditResultData["internalLinkingSuggestions"];
  orphanPages: string[];
};

export default function SeoScoresTab({
  categoryScores,
  internalLinkingSuggestions,
  orphanPages,
}: SeoScoresTabProps) {
  const { technicalSeo, onPageSeo, contentQuality, structuredData, internalLinking, eeat, localSeo, geoReadiness, aeoReadiness } =
    categoryScores;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Core categories</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <CategoryScoreBar label="Technical SEO" score={technicalSeo.score} reasoning={technicalSeo.reasoning} />
          <CategoryScoreBar label="On-Page SEO" score={onPageSeo.score} reasoning={onPageSeo.reasoning} />
          <CategoryScoreBar label="Content Quality" score={contentQuality.score} reasoning={contentQuality.reasoning} />
          <CategoryScoreBar label="Structured Data" score={structuredData.score} reasoning={structuredData.reasoning} />
          <CategoryScoreBar label="Internal Linking" score={internalLinking.score} reasoning={internalLinking.reasoning} />
          {localSeo.applicable && localSeo.score !== null && (
            <CategoryScoreBar label="Local SEO" score={localSeo.score} reasoning={localSeo.reasoning} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">EEAT</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <CategoryScoreBar label="Overall EEAT" score={eeat.score} reasoning={eeat.reasoning} />
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {eeat.factors.map((factor) => (
              <CategoryScoreBar key={factor.name} label={factor.name} score={factor.score} reasoning={factor.reasoning} />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">GEO readiness (AI search engines)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <CategoryScoreBar label="Overall GEO" score={geoReadiness.score} reasoning={geoReadiness.reasoning} />
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {geoReadiness.factors.map((factor) => (
              <CategoryScoreBar key={factor.name} label={factor.name} score={factor.score} reasoning={factor.reasoning} />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">AEO readiness (answer engines)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <CategoryScoreBar label="Overall AEO" score={aeoReadiness.score} reasoning={aeoReadiness.reasoning} />
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {aeoReadiness.factors.map((factor) => (
              <CategoryScoreBar key={factor.name} label={factor.name} score={factor.score} reasoning={factor.reasoning} />
            ))}
          </div>
        </CardContent>
      </Card>

      {(internalLinkingSuggestions.length > 0 || orphanPages.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Internal linking suggestions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {orphanPages.length > 0 && (
              <p className="text-sm text-slate-500">
                Orphan pages (not linked from any other page in this crawl sample): {orphanPages.join(", ")}
              </p>
            )}
            {internalLinkingSuggestions.map((suggestion) => (
              <div key={suggestion.title} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-1 flex items-center gap-2">
                  <Badge variant="outline">{formatEnumLabel(suggestion.type)}</Badge>
                  <span className="text-sm font-medium">{suggestion.title}</span>
                </div>
                <p className="text-sm text-slate-500">{suggestion.description}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
