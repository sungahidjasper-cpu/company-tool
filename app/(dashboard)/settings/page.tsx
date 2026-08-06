import { Settings } from "lucide-react";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EmptyState from "@/components/dashboard/EmptyState";
import PageContainer from "@/components/dashboard/PageContainer";

export default function SettingsPage() {
  return (
    <PageContainer>
      <DashboardHeader
        title="Settings"
        description="Configure your workspace."
      />

      <EmptyState
        icon={Settings}
        title="Settings coming soon"
        description="Account, team, and workspace preferences will live here."
      />
    </PageContainer>
  );
}
