type DashboardGridProps = {
  children: React.ReactNode;
};

export default function DashboardGrid({ children }: DashboardGridProps) {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
      {children}
    </div>
  );
}
