"use server";

import { revalidatePath } from "next/cache";

import {
  acceptInvitationSchema,
  inviteUserSchema,
  type AcceptInvitationInput,
  type InviteUserInput,
} from "@/features/users/schemas/invitation.schema";
import { acceptInvitation, createInvitation } from "@/features/users/services/invitation.service";
import { logActivity } from "@/lib/activity";
import { actionError, actionSuccess, type ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";

/**
 * Authenticated, ADMIN+ only — reuses Permissions.manageUsers exactly as
 * createUser/updateUser already do (features/users/actions/user.actions.ts).
 * No new invitation-specific permission.
 */
export async function inviteUserAction(input: InviteUserInput): Promise<ActionResult> {
  const actor = await requireUser();

  if (!Permissions.manageUsers(actor.role)) {
    return actionError("You do not have permission to invite users.");
  }

  const parsed = inviteUserSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  if (parsed.data.role === "SUPER_ADMIN" && actor.role !== "SUPER_ADMIN") {
    return actionError("Only a Super Admin can grant the Super Admin role.");
  }

  const result = await createInvitation(
    {
      companyId: actor.companyId,
      invitedById: actor.id,
      email: parsed.data.email,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      role: parsed.data.role,
    },
    process.env.NEXTAUTH_URL!
  );

  if (!result.ok) {
    if (result.reason === "EMAIL_ALREADY_REGISTERED") {
      return actionError("A user with that email already exists.");
    }
    if (result.reason === "INVITATION_ALREADY_PENDING") {
      return actionError("An invitation has already been sent to that email address.");
    }
    return actionError("The invitation could not be sent. Please try again.");
  }

  await logActivity({
    actorId: actor.id,
    action: "user.invited",
    companyId: actor.companyId,
    metadata: { email: parsed.data.email },
  });

  revalidatePath("/users");
  return actionSuccess();
}

export type AcceptInvitationActionResult =
  | { success: true }
  | { success: false; reason: "VALIDATION"; message: string }
  | { success: false; reason: "INVALID_TOKEN" };

/**
 * Unauthenticated by design — requireUser() must never gate this. Authorized
 * purely by possession of a valid, unexpired, unrevoked, unaccepted
 * invitation token, verified entirely server-side inside acceptInvitation().
 */
export async function acceptInvitationAction(input: AcceptInvitationInput): Promise<AcceptInvitationActionResult> {
  const parsed = acceptInvitationSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, reason: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const result = await acceptInvitation(parsed.data.token, parsed.data.password);
  if (!result.ok) {
    return { success: false, reason: "INVALID_TOKEN" };
  }

  return { success: true };
}
