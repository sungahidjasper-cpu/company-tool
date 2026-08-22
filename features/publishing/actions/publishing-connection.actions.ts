"use server";

import { revalidatePath } from "next/cache";

import { actionError, actionSuccess, type ActionResult } from "@/lib/action-result";
import { logActivity } from "@/lib/activity";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import { encryptCredentialPayload } from "@/lib/crypto/publishing-credential-crypto";
import { prisma } from "@/lib/prisma";
import { validateWordPressCredential } from "@/features/publishing/services/wordpress-connection.service";
import {
  connectDestinationInputSchema,
  disconnectDestinationInputSchema,
  updateConnectionLabelInputSchema,
  type ConnectDestinationInput,
  type DisconnectDestinationInput,
  type PublishingConnectionSummary,
  type UpdateConnectionLabelInput,
} from "@/features/publishing/schemas/publishing-connection.schema";

const PUBLISHING_SETTINGS_PATH = "/settings/publishing";

/**
 * Every field selected here is safe to return to the client — this select
 * is the one place that determines the shape leaving this file, so a
 * credential field can never be added to a response by accident.
 */
const CONNECTION_SUMMARY_SELECT = {
  id: true,
  providerType: true,
  label: true,
  baseUrl: true,
  status: true,
  createdAt: true,
  lastVerifiedAt: true,
} as const;

/**
 * Fetch-then-compare, the same idiom used throughout
 * features/ai-workspace/actions and features/seo/actions — verifies the
 * connection belongs to the acting user's company before any read/write.
 */
async function getOwnedConnection(connectionId: string, companyId: string) {
  const connection = await prisma.publishingConnection.findUnique({ where: { id: connectionId } });
  if (!connection || connection.companyId !== companyId) return null;
  return connection;
}

/**
 * Creates a new WordPress connection. Nothing is persisted unless
 * validateWordPressCredential succeeds — the credential is validated
 * in-memory first, encrypted only on success, and never touches the
 * database in any other form.
 */
export async function connectDestinationAction(
  input: ConnectDestinationInput
): Promise<ActionResult<PublishingConnectionSummary>> {
  const actor = await requireUser();
  if (!Permissions.managePublishingConnections(actor.role)) {
    return actionError("You do not have permission to manage publishing connections.");
  }

  const parsed = connectDestinationInputSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input.");
  }
  const { label, baseUrl, username, applicationPassword } = parsed.data;

  const validation = await validateWordPressCredential(baseUrl, username, applicationPassword);
  if (!validation.ok) {
    return actionError(validation.message);
  }

  const { encryptedPayload, encryptionKeyVersion } = encryptCredentialPayload(
    JSON.stringify({ username, applicationPassword })
  );

  const connection = await prisma.$transaction(async (tx) => {
    const created = await tx.publishingConnection.create({
      data: {
        companyId: actor.companyId,
        providerType: "WORDPRESS",
        label,
        baseUrl,
        status: "ACTIVE",
        createdByUserId: actor.id,
        lastVerifiedAt: new Date(),
      },
      select: CONNECTION_SUMMARY_SELECT,
    });

    await tx.publishingCredential.create({
      data: {
        connectionId: created.id,
        companyId: actor.companyId,
        credentialType: "BASIC_AUTH",
        encryptedPayload,
        encryptionKeyVersion,
      },
    });

    return created;
  });

  await logActivity({
    actorId: actor.id,
    companyId: actor.companyId,
    action: "publishing_connection.created",
    metadata: { connectionId: connection.id, provider: "WORDPRESS", label },
  });

  revalidatePath(PUBLISHING_SETTINGS_PATH);
  return actionSuccess(connection);
}

/**
 * Company-scoped, read-only. Always derives the company from the session —
 * never accepts one from the caller.
 */
export async function listConnectionsAction(): Promise<ActionResult<PublishingConnectionSummary[]>> {
  const actor = await requireUser();
  if (!Permissions.managePublishingConnections(actor.role)) {
    return actionError("You do not have permission to view publishing connections.");
  }

  const connections = await prisma.publishingConnection.findMany({
    where: { companyId: actor.companyId },
    orderBy: { createdAt: "desc" },
    select: CONNECTION_SUMMARY_SELECT,
  });

  return actionSuccess(connections);
}

export async function updateConnectionLabelAction(
  input: UpdateConnectionLabelInput
): Promise<ActionResult<PublishingConnectionSummary>> {
  const actor = await requireUser();
  if (!Permissions.managePublishingConnections(actor.role)) {
    return actionError("You do not have permission to manage publishing connections.");
  }

  const parsed = updateConnectionLabelInputSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  const existing = await getOwnedConnection(parsed.data.connectionId, actor.companyId);
  if (!existing) {
    return actionError("Publishing connection not found.");
  }

  const updated = await prisma.publishingConnection.update({
    where: { id: existing.id },
    data: { label: parsed.data.label },
    select: CONNECTION_SUMMARY_SELECT,
  });

  revalidatePath(PUBLISHING_SETTINGS_PATH);
  return actionSuccess(updated);
}

/**
 * Soft-revokes the connection (status: REVOKED, row persists) while
 * hard-deleting the credential row in the same transaction — the secret is
 * actually gone; the connection's own history/attribution is not.
 */
export async function disconnectDestinationAction(input: DisconnectDestinationInput): Promise<ActionResult> {
  const actor = await requireUser();
  if (!Permissions.managePublishingConnections(actor.role)) {
    return actionError("You do not have permission to manage publishing connections.");
  }

  const parsed = disconnectDestinationInputSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  const existing = await getOwnedConnection(parsed.data.connectionId, actor.companyId);
  if (!existing) {
    return actionError("Publishing connection not found.");
  }

  await prisma.$transaction([
    prisma.publishingCredential.deleteMany({ where: { connectionId: existing.id } }),
    prisma.publishingConnection.update({ where: { id: existing.id }, data: { status: "REVOKED" } }),
  ]);

  await logActivity({
    actorId: actor.id,
    companyId: actor.companyId,
    action: "publishing_connection.disconnected",
    metadata: { connectionId: existing.id, provider: existing.providerType, label: existing.label },
  });

  revalidatePath(PUBLISHING_SETTINGS_PATH);
  return actionSuccess();
}
