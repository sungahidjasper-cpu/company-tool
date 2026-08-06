import { Bot } from "lucide-react";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EmptyState from "@/components/dashboard/EmptyState";
import PageContainer from "@/components/dashboard/PageContainer";

export default function AiWorkspacePage() {
  return (
    <PageContainer>
      <DashboardHeader
        title="AI Workspace"
        description="AI-assisted tools for the team."
      />

      <EmptyState
        icon={Bot}
        title="AI Workspace coming soon"
        description="AI-assisted workflows and automations will live here."
      />
    </PageContainer>
  );
}
