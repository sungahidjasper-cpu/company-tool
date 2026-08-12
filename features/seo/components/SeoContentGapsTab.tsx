import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SeoAuditResultData } from "@/features/seo/schemas/seo-audit.schema";

type SeoContentGapsTabProps = {
  contentGaps: SeoAuditResultData["contentGaps"];
};

export default function SeoContentGapsTab({ contentGaps }: SeoContentGapsTabProps) {
  if (contentGaps.length === 0) {
    return <p className="text-sm text-slate-500">No content gaps identified.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {contentGaps.map((gap) => (
        <Card key={gap.title}>
          <CardHeader>
            <CardTitle className="text-sm">{gap.title}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            <p className="text-slate-600">{gap.description}</p>
            <p className="text-slate-500">
              <span className="font-medium text-slate-700">Why: </span>
              {gap.reasoning}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
