import { FileText } from "lucide-react";
import Link from "next/link";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import RecentAiGenerations from "@/features/ai-workspace/components/RecentAiGenerations";
import { describeProviderConfiguration } from "@/lib/ai/providers/registry";
import { requireUser } from "@/lib/auth";
import { formatEnumLabel } from "@/lib/utils";

export default async function AiWorkspacePage() {
  const user = await requireUser();
  const providerStatuses = await describeProviderConfiguration();
  const activeProvider = providerStatuses.find((status) => status.configured && status.health === "HEALTHY");

  return (
    <PageContainer>
      <DashboardHeader
        title="AI Workspace"
        description="AI-assisted tools for the team. Every generation is tracked in AI Usage."
      />

      <p className="text-sm text-slate-500">
        {activeProvider ? `Currently using: ${formatEnumLabel(activeProvider.name)}` : "No AI provider is currently configured and healthy."}
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Available tools</CardTitle>
        </CardHeader>
        <CardContent>
          <Link
            href="/ai/content-brief/new"
            className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 transition-shadow hover:shadow-md"
          >
            <div className="rounded-xl bg-slate-100 p-3">
              <FileText size={22} className="text-[#2F4156]" />
            </div>
            <div>
              <p className="font-semibold text-slate-800">SEO Content Brief</p>
              <p className="text-sm text-slate-500">
                Generate a title, meta tags, outline, and SEO/GEO/AEO suggestions for a target keyword.
              </p>
            </div>
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent generations</CardTitle>
        </CardHeader>
        <CardContent>
          <RecentAiGenerations companyId={user.companyId} />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
