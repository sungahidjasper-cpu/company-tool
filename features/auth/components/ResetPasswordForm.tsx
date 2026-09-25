"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { resetPasswordAction } from "@/features/auth/actions/password-reset.actions";
import {
  resetPasswordSchema,
  type ResetPasswordInput,
} from "@/features/auth/schemas/password-reset.schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Phase = "form" | "success" | "invalid";

export default function ResetPasswordForm({ token }: { token: string | null }) {
  const [phase, setPhase] = useState<Phase>(token ? "form" : "invalid");
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token: token ?? "", newPassword: "", confirmPassword: "" },
  });

  const onSubmit = async (data: ResetPasswordInput) => {
    setFormError(null);

    const result = await resetPasswordAction(data);
    if (result.success) {
      setPhase("success");
      return;
    }

    if (result.reason === "INVALID_TOKEN") {
      setPhase("invalid");
      return;
    }

    setFormError(result.message);
  };

  if (phase === "invalid") {
    return (
      <div className="flex flex-col gap-4 text-center">
        <h2 className="font-heading text-lg font-medium">Reset link unavailable</h2>
        <p className="text-sm text-slate-500">This password reset link is invalid or has expired.</p>
        <Button className="w-full" render={<Link href="/forgot-password" />}>
          Request a new reset link
        </Button>
      </div>
    );
  }

  if (phase === "success") {
    return (
      <div className="flex flex-col gap-4 text-center">
        <h2 className="font-heading text-lg font-medium">Password reset successfully</h2>
        <p className="text-sm text-slate-500">Your password has been updated. Please sign in with your new password.</p>
        <Button className="w-full" render={<Link href="/login" />}>
          Go to login
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <input type="hidden" {...register("token")} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="newPassword" className="text-sm font-medium">
          New password
        </label>
        <Input id="newPassword" type="password" autoComplete="new-password" {...register("newPassword")} />
        {errors.newPassword && <p className="text-sm text-destructive">{errors.newPassword.message}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="confirmPassword" className="text-sm font-medium">
          Confirm new password
        </label>
        <Input id="confirmPassword" type="password" autoComplete="new-password" {...register("confirmPassword")} />
        {errors.confirmPassword && <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>}
      </div>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? "Resetting..." : "Reset password"}
      </Button>
    </form>
  );
}
