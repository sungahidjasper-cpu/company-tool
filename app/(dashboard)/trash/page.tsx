import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import TrashTable from "@/features/trash/components/TrashTable";
import { getTrashItems } from "@/features/trash/services/trash.service";
import { requireUser } from "@/lib/auth";

export default async function TrashPage() {
  const user = await requireUser();
  const items = await getTrashItems(user.companyId);

  return (
    <PageContainer>
      <DashboardHeader
        title="Trash"
        description="Restore content, keywords, files, and notes you've deleted. Deleted items stay here until restored or permanently deleted."
      />

      <TrashTable items={items} />
    </PageContainer>
  );
}
