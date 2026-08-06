import { Search } from "lucide-react";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EmptyState from "@/components/dashboard/EmptyState";
import PageContainer from "@/components/dashboard/PageContainer";

export default function SeoPage() {
  return (
    <PageContainer>
      <DashboardHeader
        title="SEO Workspace"
        description="Monitor search performance and optimization work."
      />

      <EmptyState
        icon={Search}
        title="SEO Workspace coming soon"
        description="Keyword tracking, audits, and reporting will live here."
      />
    </PageContainer>
  );
}
