import type { Metadata } from "next";
import { redirect } from "next/navigation";

import LoginForm from "@/features/auth/components/LoginForm";
import { getCurrentUser } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Log in",
  description: "Sign in to your Cloud Compass OS workspace.",
};

export default async function LoginPage() {
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
        <h1 className="font-heading text-xl leading-snug font-medium">Cloud Compass OS</h1>
        <CardDescription>Sign in to your workspace</CardDescription>
      </CardHeader>

      <CardContent>
        <LoginForm />
      </CardContent>
    </Card>
  );
}
