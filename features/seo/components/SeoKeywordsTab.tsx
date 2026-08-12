import { Sparkles } from "lucide-react";

import EmptyState from "@/components/dashboard/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SeoAuditResultData } from "@/features/seo/schemas/seo-audit.schema";

type SeoKeywordsTabProps = {
  keywordIntelligence: SeoAuditResultData["keywordIntelligence"];
};

function KeywordBadgeList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-slate-500">None detected.</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <Badge key={item} variant="secondary">
          {item}
        </Badge>
      ))}
    </div>
  );
}

export default function SeoKeywordsTab({ keywordIntelligence }: SeoKeywordsTabProps) {
  if (!keywordIntelligence) {
    return (
      <EmptyState
        icon={Sparkles}
        title="AI keyword intelligence unavailable"
        description="This run's keyword/content-cluster generation didn't complete — deterministic crawl results in the other tabs are unaffected."
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Search intent</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-600">{keywordIntelligence.searchIntentSummary}</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm">Primary keywords</CardTitle>
          </CardHeader>
          <CardContent>
            <KeywordBadgeList items={keywordIntelligence.primaryKeywords} />
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm">Secondary keywords</CardTitle>
          </CardHeader>
          <CardContent>
            <KeywordBadgeList items={keywordIntelligence.secondaryKeywords} />
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm">Long-tail keywords</CardTitle>
          </CardHeader>
          <CardContent>
            <KeywordBadgeList items={keywordIntelligence.longTailKeywords} />
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm">Semantic keywords</CardTitle>
          </CardHeader>
          <CardContent>
            <KeywordBadgeList items={keywordIntelligence.semanticKeywords} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Content clusters</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {keywordIntelligence.contentClusters.length === 0 ? (
            <p className="text-sm text-slate-500">None suggested.</p>
          ) : (
            keywordIntelligence.contentClusters.map((cluster) => (
              <div key={cluster.clusterName}>
                <p className="mb-1 text-sm font-medium">{cluster.clusterName}</p>
                <KeywordBadgeList items={cluster.keywords} />
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
