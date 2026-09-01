import {
  CalendarDays,
  FileEdit,
  FileText,
  Image as ImageIcon,
  Link2,
  Mail,
  MessageSquareText,
  Network,
  Newspaper,
  Search,
  ShieldCheck,
  Tags,
  Users,
} from "lucide-react";
import Link from "next/link";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import RecentAiGenerations from "@/features/ai-workspace/components/RecentAiGenerations";
import { describeProviderConfiguration } from "@/lib/ai/providers/registry";
import { requireUser } from "@/lib/auth";
import { formatEnumLabel } from "@/lib/utils";

/**
 * Phase 21 §17 — a navigation shell only. Five tools are real; the other
 * nine are visibly-disabled placeholders so the layout doesn't need a
 * redesign as each one gets built out in a future phase (per the review's
 * item 18: deepen Content Brief/Draft now, don't build new shallow tools).
 */
const AI_TOOLS = [
  { name: "SEO Content Brief", description: "Configurable title, meta tags, outline, FAQ, and SEO/GEO/AEO suggestions for a target keyword.", href: "/ai/content-brief/new", icon: FileText, status: "available" as const },
  { name: "Long-Form Content Draft", description: "Generate a full draft article from an approved brief.", href: "/ai/content-brief/new", icon: FileEdit, status: "available" as const },
  { name: "Meta Tag Optimizer", description: "Bulk-review and improve meta titles/descriptions across existing content.", href: null, icon: Tags, status: "coming-soon" as const },
  { name: "Internal Link Analyzer", description: "Suggest internal linking opportunities across your site.", href: "/ai/internal-link-analyzer/new", icon: Link2, status: "available" as const },
  { name: "Content Gap Analysis", description: "Find topics competitors rank for that you don't cover yet.", href: null, icon: Search, status: "coming-soon" as const },
  { name: "Competitor Content Analysis", description: "Compare your content against top-ranking competitor pages.", href: null, icon: Users, status: "coming-soon" as const },
  { name: "Schema Markup Generator", description: "Generate structured-data markup for existing pages.", href: "/ai/schema-markup/new", icon: ShieldCheck, status: "available" as const },
  { name: "Content Rewriter", description: "Refresh and improve underperforming existing content.", href: null, icon: FileEdit, status: "coming-soon" as const },
  { name: "Topic Cluster Planner", description: "Plan pillar/cluster content structures around a topic.", href: null, icon: Network, status: "coming-soon" as const },
  { name: "Content Calendar Assistant", description: "Plan and schedule upcoming content topics.", href: null, icon: CalendarDays, status: "coming-soon" as const },
  { name: "Image Alt Text Generator", description: "Generate SEO-friendly alt text for existing images.", href: null, icon: ImageIcon, status: "coming-soon" as const },
  { name: "Social Snippet Generator", description: "Turn published content into social media posts.", href: "/ai/social-snippet-generator/new", icon: MessageSquareText, status: "available" as const },
  { name: "Press Release Generator", description: "Draft press releases grounded in verified facts.", href: null, icon: Newspaper, status: "coming-soon" as const },
  { name: "Email Newsletter Drafter", description: "Summarize recent content into a newsletter draft.", href: null, icon: Mail, status: "coming-soon" as const },
] as const;

export default async function AiWorkspacePage() {
  const user = await requireUser();
  const providerStatuses = await describeProviderConfiguration();
  const activeProvider = providerStatuses.find((status) => status.configured && status.health === "HEALTHY");

  return (
    <PageContainer>
      <DashboardHeader
        title="AI Workspace"
        description="AI-assisted tools for the team. Every generation is tracked in AI Usage."
      />

      <p className="text-sm text-slate-500">
        {activeProvider ? `Currently using: ${formatEnumLabel(activeProvider.name)}` : "No AI provider is currently configured and healthy."}
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI tools</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {AI_TOOLS.map((tool) => {
              const Icon = tool.icon;
              const card = (
                <div
                  className={`flex h-full items-start gap-4 rounded-xl border border-slate-200 bg-white p-4 ${
                    tool.status === "available" ? "transition-shadow hover:shadow-md" : "opacity-60"
                  }`}
                >
                  <div className="rounded-xl bg-slate-100 p-3">
                    <Icon size={22} className="text-[#2F4156]" />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-800">{tool.name}</p>
                    <p className="text-sm text-slate-500">{tool.description}</p>
                    {tool.status === "coming-soon" && <p className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-400">Coming soon</p>}
                  </div>
                </div>
              );

              return tool.status === "available" && tool.href ? (
                <Link key={tool.name} href={tool.href}>
                  {card}
                </Link>
              ) : (
                <div key={tool.name}>{card}</div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent generations</CardTitle>
        </CardHeader>
        <CardContent>
          <RecentAiGenerations companyId={user.companyId} />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
