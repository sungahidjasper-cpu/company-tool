import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import { listClientOptions } from "@/features/clients/services/client.service";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";

/**
 * Settings → Clients.
 *
 * The first step of "Settings → Clients → Select client → Social accounts".
 * Nothing is configured here; this page only chooses which client's settings
 * to open, and reports how many social accounts each already has so the list
 * is informative rather than a bare index.
 */
export default async function ClientSettingsPage() {
  const actor = await requireUser();
  if (!Permissions.manageClients(actor.role)) {
    redirect("/settings");
  }

  const clients = await listClientOptions(actor.companyId);
  const counts = await prisma.socialAccount.groupBy({
    by: ["clientId"],
    where: { companyId: actor.companyId, deletedAt: null, status: "ACTIVE" },
    _count: { _all: true },
  });
  const countByClient = new Map(counts.map((row) => [row.clientId, row._count._all]));

  return (
    <PageContainer>
      <DashboardHeader
        title="Client settings"
        description="Choose a client to configure the social accounts a post can be written for."
      />

      {clients.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
          No clients yet. Add a client first — social accounts belong to a client, so there is nothing to configure until one exists.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {clients.map((client) => {
            const count = countByClient.get(client.id) ?? 0;
            return (
              <li key={client.id}>
                <Link
                  href={`/settings/clients/${client.id}/social-accounts`}
                  className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-300"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium text-slate-700">{client.name}</span>
                    <span className="text-sm text-slate-500">
                      {count === 0 ? "No social accounts configured" : `${count} social account${count === 1 ? "" : "s"}`}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-slate-400" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </PageContainer>
  );
}
