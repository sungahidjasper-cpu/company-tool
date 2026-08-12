import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SeoAuditResultData } from "@/features/seo/schemas/seo-audit.schema";

type SeoStructuredDataTabProps = {
  structuredDataRecommendations: SeoAuditResultData["structuredDataRecommendations"];
  detectedSchemaTypes: string[];
};

export default function SeoStructuredDataTab({
  structuredDataRecommendations,
  detectedSchemaTypes,
}: SeoStructuredDataTabProps) {
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Already detected</CardTitle>
        </CardHeader>
        <CardContent>
          {detectedSchemaTypes.length === 0 ? (
            <p className="text-sm text-slate-500">No structured data detected on the crawled pages.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {detectedSchemaTypes.map((type) => (
                <Badge key={type} variant="secondary">
                  {type}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {structuredDataRecommendations.length === 0 ? (
        <p className="text-sm text-slate-500">No additional structured data recommended.</p>
      ) : (
        structuredDataRecommendations.map((recommendation) => (
          <Card key={recommendation.schemaType}>
            <CardHeader>
              <CardTitle className="text-sm">{recommendation.schemaType}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <p className="text-sm text-slate-600">{recommendation.reasoning}</p>
              <pre className="max-h-64 overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-100">
                {recommendation.exampleJsonLd}
              </pre>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
