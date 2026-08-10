import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import KanbanBoard from "@/features/leads/components/KanbanBoard";
import { getLeadsByStage } from "@/features/leads/services/lead.service";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";

export default async function PipelinePage() {
  const user = await requireUser();
  const canManageLeads = Permissions.manageLeads(user.role);

  const stages = await getLeadsByStage(user.companyId);

  const serializableStages = stages.map((stage) => ({
    status: stage.status,
    leads: stage.leads.map((lead) => ({
      id: lead.id,
      name: lead.name,
      companyName: lead.companyName,
      value: lead.value ? lead.value.toString() : null,
      assignedUserId: lead.assignedUserId,
      assignedUser: lead.assignedUser,
    })),
  }));

  return (
    <PageContainer>
      <DashboardHeader
        title="Pipeline"
        description="Drag a lead card to move it between stages."
      />

      <KanbanBoard
        stages={serializableStages}
        currentUserId={user.id}
        canManageLeads={canManageLeads}
      />
    </PageContainer>
  );
}
