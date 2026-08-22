import Link from "next/link";
import { Settings, Share2 } from "lucide-react";

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

      <Link
        href="/settings/publishing"
        className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-300"
      >
        <Share2 className="size-5 text-slate-500" />
        <span className="flex flex-col">
          <span className="font-medium text-slate-700">Publishing connections</span>
          <span className="text-sm text-slate-500">Connect external destinations you can later publish approved content to.</span>
        </span>
      </Link>

      <EmptyState
        icon={Settings}
        title="More settings coming soon"
        description="Account, team, and workspace preferences will live here."
      />
    </PageContainer>
  );
}
