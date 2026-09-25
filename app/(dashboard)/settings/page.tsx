import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Bot, Building2, Share2, UserCircle, UserCog, Users } from "lucide-react";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import { requireUser } from "@/lib/auth";
import { hasMinimumRole, Permissions } from "@/lib/authorization";

/**
 * One settings destination — same card markup this page already used for
 * its two original links, now shared instead of repeated per link.
 */
function SettingsLink({ href, icon: Icon, title, description }: { href: string; icon: LucideIcon; title: string; description: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-300">
      <Icon className="size-5 text-slate-500" />
      <span className="flex flex-col">
        <span className="font-medium text-slate-700">{title}</span>
        <span className="text-sm text-slate-500">{description}</span>
      </span>
    </Link>
  );
}

/** A labeled group of settings destinations — personal, company, and integration settings stay visually apart even though today they're all just links out. */
function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</h2>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

/**
 * Settings is a navigation hub only — every link below points at a page
 * that already exists and already enforces its own permission server-side
 * (Company edit, Users, Publishing, Social accounts). The checks here only
 * decide whether a section is WORTH showing to this role; removing one
 * changes nothing about what the destination page itself allows, and every
 * one of these checks reuses the exact rule its destination page already
 * applies — never a new or looser rule invented for this menu.
 */
export default async function SettingsPage() {
  const actor = await requireUser();

  /* Same condition app/(dashboard)/companies/[id]/edit/page.tsx applies for the actor's own company. */
  const canManageOwnCompany = Permissions.manageCompanies(actor.role) || hasMinimumRole(actor.role, "ADMIN");
  const canManageUsers = Permissions.manageUsers(actor.role);
  const canManagePublishing = Permissions.managePublishingConnections(actor.role);
  const canManageSocial = Permissions.manageClients(actor.role);
  const showIntegrations = canManagePublishing || canManageSocial;

  return (
    <PageContainer>
      <DashboardHeader title="Settings" description="Configure your workspace." />

      <SettingsSection title="Your account">
        <SettingsLink href="/profile" icon={UserCircle} title="Profile" description="Update your name, email, and password." />
      </SettingsSection>

      {canManageOwnCompany && (
        <SettingsSection title="Company">
          <SettingsLink
            href={`/companies/${actor.companyId}/edit`}
            icon={Building2}
            title="Company information"
            description="Manage your company's name, industry, website, and timezone."
          />
        </SettingsSection>
      )}

      {canManageUsers && (
        <SettingsSection title="Users & access">
          <SettingsLink href="/users" icon={UserCog} title="Users" description="Manage who has access to your workspace and their roles." />
        </SettingsSection>
      )}

      {showIntegrations && (
        <SettingsSection title="Integrations">
          {canManagePublishing && (
            <SettingsLink
              href="/settings/publishing"
              icon={Share2}
              title="Publishing connections"
              description="Connect external destinations you can later publish approved content to."
            />
          )}
          {canManageSocial && (
            <SettingsLink
              href="/settings/clients"
              icon={Users}
              title="Social accounts"
              description="Configure each client's social accounts — the platforms their posts are written for."
            />
          )}
        </SettingsSection>
      )}

      <SettingsSection title="AI usage & limits">
        <SettingsLink href="/ai-usage" icon={Bot} title="AI usage" description="See AI spend, activity, and provider performance for your company." />
      </SettingsSection>
    </PageContainer>
  );
}
