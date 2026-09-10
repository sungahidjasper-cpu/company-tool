import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import SocialAccountManager from "@/features/social/components/SocialAccountManager";
import { listClientSocialAccountsAction } from "@/features/social/actions/social-account.actions";
import { listPlatformConnectivityAction } from "@/features/social/actions/social-connection.actions";
import ConnectionErrorNotice from "@/features/social/components/ConnectionErrorNotice";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { isUuid } from "@/lib/utils";

/**
 * Settings → Clients → [client] → Social accounts.
 *
 * The client id comes from the URL, so it is shape-checked before any query —
 * Postgres throws on a malformed uuid cast rather than returning zero rows —
 * and then resolved through the actor's own company. Another company's client
 * is a plain not-found, indistinguishable from one that does not exist.
 */
type PageProps = {
  params: Promise<{ id: string }>;
  /*
   * `connectError` is a SHORT CODE the OAuth callback sets when a flow
   * could not be completed — never a message, and never anything a
   * provider said. The wording lives in ConnectionErrorNotice, so nothing
   * arbitrary from a URL is ever rendered.
   */
  searchParams: Promise<{ connectError?: string }>;
};

export default async function ClientSocialAccountsPage({ params, searchParams }: PageProps) {
  const actor = await requireUser();
  if (!Permissions.manageClients(actor.role)) {
    redirect("/settings");
  }

  const { id } = await params;
  if (!isUuid(id)) notFound();

  const client = await prisma.client.findUnique({
    where: { id },
    select: { id: true, name: true, companyId: true, deletedAt: true },
  });
  if (!client || client.companyId !== actor.companyId || client.deletedAt !== null) notFound();

  const result = await listClientSocialAccountsAction(client.id);
  const accounts = result.success ? result.data : [];

  /*
   * Derived on the server, per request: whether each platform has a real
   * provider and whether THIS deployment is configured for it. The UI states
   * the answer in words rather than offering a Connect button that cannot
   * work.
   */
  const connectivityResult = await listPlatformConnectivityAction();
  const connectivity = connectivityResult.success ? connectivityResult.data : [];

  const { connectError } = await searchParams;

  return (
    <PageContainer>
      <Link href="/settings/clients" className="flex w-fit items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={14} /> Client settings
      </Link>

      <DashboardHeader
        title={`${client.name} — social accounts`}
        description="Who this client is on each platform, and which of those Cloud Compass is actually connected to."
      />

      <ConnectionErrorNotice code={connectError} />

      <SocialAccountManager
        clientId={client.id}
        clientName={client.name}
        initialAccounts={accounts}
        connectivity={connectivity}
      />
    </PageContainer>
  );
}
