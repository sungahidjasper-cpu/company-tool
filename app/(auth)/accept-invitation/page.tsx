import type { Metadata } from "next";

import AcceptInvitationForm from "@/features/users/components/AcceptInvitationForm";
import { getInvitationPreview } from "@/features/users/services/invitation.service";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Accept your invitation",
  description: "Set up your Cloud Compass OS account.",
};

type AcceptInvitationPageProps = {
  searchParams: Promise<{ token?: string }>;
};

/**
 * Deliberately does not check for an existing session (unlike /login and
 * /forgot-password) — same reasoning as /reset-password: possessing a valid
 * invitation link must work regardless of whatever session this browser
 * currently holds.
 */
export default async function AcceptInvitationPage({ searchParams }: AcceptInvitationPageProps) {
  const { token } = await searchParams;
  const preview = token ? await getInvitationPreview(token) : null;

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="items-center text-center">
        <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--primary)] text-lg font-bold text-white">
          CC
        </div>
        <h1 className="font-heading text-xl leading-snug font-medium">Accept your invitation</h1>
        <CardDescription>Set up your Cloud Compass OS account</CardDescription>
      </CardHeader>

      <CardContent>
        <AcceptInvitationForm token={token ?? null} preview={preview} />
      </CardContent>
    </Card>
  );
}
