"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  UserCog,
  Users,
  FolderKanban,
  Search,
  Bot,
  Settings,
  FileBarChart,
} from "lucide-react";

import { hasMinimumRole } from "@/lib/authorization";
import type { UserRole } from "@/lib/generated/prisma/enums";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const menuItems = [
  { name: "Dashboard", icon: LayoutDashboard, href: "/dashboard" },
  { name: "Companies", icon: Building2, href: "/companies", minRole: "SUPER_ADMIN" as UserRole },
  { name: "Users", icon: UserCog, href: "/users", minRole: "ADMIN" as UserRole },
  { name: "Clients", icon: Users, href: "/clients" },
  { name: "Projects", icon: FolderKanban, href: "/projects" },
  { name: "SEO Workspace", icon: Search, href: "/seo" },
  { name: "AI Workspace", icon: Bot, href: "/ai" },
  { name: "Reports", icon: FileBarChart, href: "/reports" },
  { name: "Settings", icon: Settings, href: "/settings" },
];

type AppSidebarProps = {
  role: UserRole;
};

export default function AppSidebar({ role }: AppSidebarProps) {
  const pathname = usePathname();

  const visibleItems = menuItems.filter(
    (item) => !item.minRole || hasMinimumRole(role, item.minRole)
  );

  return (
    <Sidebar
      collapsible="icon"
      style={
        {
          "--sidebar": "#1e293b",
          "--sidebar-foreground": "#ffffff",
          "--sidebar-accent": "#ffffff",
          "--sidebar-accent-foreground": "#2F4156",
          "--sidebar-border": "rgba(255,255,255,0.1)",
        } as React.CSSProperties
      }
    >
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-slate-400">Navigation</SidebarGroupLabel>

          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => {
                const isActive =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);

                return (
                  <SidebarMenuItem key={item.name}>
                    <SidebarMenuButton
                      isActive={isActive}
                      tooltip={item.name}
                      render={<Link href={item.href} />}
                      className="text-slate-300 hover:bg-white/10 hover:text-white"
                    >
                      <item.icon size={18} />
                      <span>{item.name}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
