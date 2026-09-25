import type { Metadata } from "next";
import { redirect } from "next/navigation";

import ForgotPasswordForm from "@/features/auth/components/ForgotPasswordForm";
import { getCurrentUser } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Forgot your password?",
  description: "Reset your Cloud Compass OS password.",
};

export default async function ForgotPasswordPage() {
  const user = await getCurrentUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="items-center text-center">
        <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--primary)] text-lg font-bold text-white">
          CC
        </div>
        <h1 className="font-heading text-xl leading-snug font-medium">Forgot your password?</h1>
        <CardDescription>We&apos;ll send you a reset link</CardDescription>
      </CardHeader>

      <CardContent>
        <ForgotPasswordForm />
      </CardContent>
    </Card>
  );
}
