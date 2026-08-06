import { FileBarChart } from "lucide-react";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EmptyState from "@/components/dashboard/EmptyState";
import PageContainer from "@/components/dashboard/PageContainer";

export default function ReportsPage() {
  return (
    <PageContainer>
      <DashboardHeader
        title="Reports"
        description="Company-wide analytics and reporting."
      />

      <EmptyState
        icon={FileBarChart}
        title="Reports coming soon"
        description="Cross-module analytics and exports will live here."
      />
    </PageContainer>
  );
}
