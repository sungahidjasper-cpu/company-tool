import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import DiscoveredAccountPicker from "@/features/social/components/DiscoveredAccountPicker";
import { SOCIAL_CONNECT_SELECTION_COOKIE } from "@/features/social/services/social-connect-cookie";
import { peekDiscoveredAccounts } from "@/features/social/services/social-oauth-state.service";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { isUuid } from "@/lib/utils";

/**
 * Phase 9 — choosing which Facebook Page this client is.
 *
 * Reached only from the OAuth callback, which sets an httpOnly cookie holding
 * a single-use selection token. Everything shown here comes from what Meta
 * itself reported: the names and ids are the platform's, not typed by anyone.
 *
 * WHY A PICKER AT ALL. An authorization can cover several Pages, and only a
 * person knows which one is this client. Guessing — taking the first, or
 * matching on a name — would attach a client to the wrong Page.
 *
 * WHAT IS NOT WRITTEN YET. Nothing. No account, no credential, no CONNECTED
 * state. Rendering this page changes no data; leaving without choosing leaves
 * the client exactly as it was. The selection token is not redeemed by
 * viewing this page either, so a refresh does not break the flow.
 *
 * THE TOKEN NEVER REACHES THE BROWSER. It stays in the httpOnly cookie the
 * callback set; the server action that finishes the connection reads it from
 * there. Only public page ids are rendered.
 */
type PageProps = { params: Promise<{ id: string }> };

export default async function ConnectFacebookPage({ params }: PageProps) {
  const actor = await requireUser();
  if (!Permissions.manageClients(actor.role)) redirect("/settings");

  const { id } = await params;
  if (!isUuid(id)) notFound();

  const client = await prisma.client.findUnique({
    where: { id },
    select: { id: true, name: true, companyId: true, deletedAt: true },
  });
  if (!client || client.companyId !== actor.companyId || client.deletedAt !== null) notFound();

  const accountsPath = `/settings/clients/${client.id}/social-accounts`;

  const cookieStore = await cookies();
  const selectionToken = cookieStore.get(SOCIAL_CONNECT_SELECTION_COOKIE)?.value ?? null;

  const peeked = await peekDiscoveredAccounts(selectionToken);
  /*
   * Every failure — no cookie, expired, already used, unreadable — lands back
   * on the accounts page with the same code. There is no partial state to
   * recover, and telling a browser which of those it was is information about
   * someone else's flow.
   */
  if (!peeked.ok) redirect(`${accountsPath}?connectError=state`);

  /*
   * The flow's own company and client, from the server-side row. The URL says
   * which client this page is for, but the ROW decides: a mismatch means this
   * selection does not belong here, and it is refused rather than reconciled.
   */
  if (peeked.companyId !== actor.companyId || peeked.clientId !== client.id) {
    redirect(`${accountsPath}?connectError=state`);
  }

  return (
    <PageContainer>
      <Link href={accountsPath} className="flex w-fit items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={14} /> {client.name} — social accounts
      </Link>

      <DashboardHeader
        title="Choose the Facebook Page"
        description={`Facebook reported these Pages for the account you authorized. Pick the one that is ${client.name}.`}
      />

      <DiscoveredAccountPicker clientId={client.id} accounts={peeked.discovered} platform="FACEBOOK" />
    </PageContainer>
  );
}
