import PageTitle from "@/components/dashboard/PageTitle";

type DashboardHeaderProps = {
  title: string;
  description?: string;
  actions?: React.ReactNode;
};

export default function DashboardHeader({
  title,
  description,
  actions,
}: DashboardHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <PageTitle title={title} description={description} />

      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
