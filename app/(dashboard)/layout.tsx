import AppLayout from "@/components/layout/AppLayout";
import { requireUser } from "@/lib/auth";

export default async function DashboardGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireUser();

  return <AppLayout>{children}</AppLayout>;
}
