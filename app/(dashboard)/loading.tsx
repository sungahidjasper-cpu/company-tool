import DashboardGrid from "@/components/dashboard/DashboardGrid";
import LoadingCard from "@/components/dashboard/LoadingCard";
import PageContainer from "@/components/dashboard/PageContainer";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardGroupLoading() {
  return (
    <PageContainer>
      <Skeleton className="h-9 w-48" />

      <DashboardGrid>
        <LoadingCard />
        <LoadingCard />
        <LoadingCard />
        <LoadingCard />
      </DashboardGrid>
    </PageContainer>
  );
}
