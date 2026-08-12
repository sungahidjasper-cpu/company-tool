import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Recommendation } from "@/features/seo/schemas/seo-audit.schema";
import { formatEnumLabel } from "@/lib/utils";

type SeoRecommendationsTabProps = {
  recommendations: Recommendation[];
};

const PRIORITY_BADGE_VARIANT: Record<Recommendation["priority"], "destructive" | "default" | "secondary" | "outline"> = {
  CRITICAL: "destructive",
  HIGH: "default",
  MEDIUM: "secondary",
  LOW: "outline",
};

export default function SeoRecommendationsTab({ recommendations }: SeoRecommendationsTabProps) {
  if (recommendations.length === 0) {
    return <p className="text-sm text-slate-500">No recommendations generated.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {recommendations.map((recommendation, index) => (
        <Card key={`${recommendation.title}-${index}`}>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={PRIORITY_BADGE_VARIANT[recommendation.priority]}>
                {formatEnumLabel(recommendation.priority)}
              </Badge>
              <Badge variant="outline">{formatEnumLabel(recommendation.category)}</Badge>
              <span className="font-semibold">{recommendation.title}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p className="text-slate-600">{recommendation.description}</p>
            <p className="text-slate-500">
              <span className="font-medium text-slate-700">Why it matters: </span>
              {recommendation.whyItMatters}
            </p>
            <div className="flex gap-4 text-xs text-slate-500">
              <span>
                Impact: <span className="font-medium text-slate-700">{formatEnumLabel(recommendation.estimatedImpact)}</span>
              </span>
              <span>
                Difficulty: <span className="font-medium text-slate-700">{formatEnumLabel(recommendation.difficulty)}</span>
              </span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
