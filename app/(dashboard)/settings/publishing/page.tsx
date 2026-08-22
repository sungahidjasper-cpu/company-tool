import { redirect } from "next/navigation";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import ConnectionManager from "@/features/publishing/components/ConnectionManager";
import { listConnectionsAction } from "@/features/publishing/actions/publishing-connection.actions";

export default async function PublishingSettingsPage() {
  const actor = await requireUser();
  if (!Permissions.managePublishingConnections(actor.role)) {
    redirect("/settings");
  }

  const result = await listConnectionsAction();
  const connections = result.success ? result.data : [];

  return (
    <PageContainer>
      <DashboardHeader
        title="Publishing connections"
        description="Connect external destinations you can later publish approved content to."
      />
      <ConnectionManager initialConnections={connections} />
    </PageContainer>
  );
}
