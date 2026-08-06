import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import AppHeader from "@/components/layout/AppHeader";
import AppSidebar from "@/components/layout/AppSidebar";
import { getCurrentUser } from "@/lib/auth";

type AppLayoutProps = {
  children: React.ReactNode;
};

export default async function AppLayout({ children }: AppLayoutProps) {
  const user = await getCurrentUser();

  return (
    <SidebarProvider>
      <AppSidebar role={user?.role ?? "EMPLOYEE"} />

      <SidebarInset>
        <AppHeader />

        <div className="flex-1 bg-slate-100 p-8">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
