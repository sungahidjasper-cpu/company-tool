import type { Metadata } from "next";

import ResetPasswordForm from "@/features/auth/components/ResetPasswordForm";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Reset your password",
  description: "Set a new password for your Cloud Compass OS account.",
};

type ResetPasswordPageProps = {
  searchParams: Promise<{ token?: string }>;
};

/**
 * Deliberately does not redirect an already-authenticated visitor away
 * (unlike /login and /forgot-password) — possessing a valid reset link must
 * work regardless of whatever session this browser currently holds.
 */
export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const { token } = await searchParams;

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="items-center text-center">
        <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--primary)] text-lg font-bold text-white">
          CC
        </div>
        <h1 className="font-heading text-xl leading-snug font-medium">Reset your password</h1>
        <CardDescription>Choose a new password for your account</CardDescription>
      </CardHeader>

      <CardContent>
        <ResetPasswordForm token={token ?? null} />
      </CardContent>
    </Card>
  );
}
