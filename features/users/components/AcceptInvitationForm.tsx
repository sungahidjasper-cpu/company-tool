"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { acceptInvitationAction } from "@/features/users/actions/invitation.actions";
import {
  acceptInvitationSchema,
  type AcceptInvitationInput,
} from "@/features/users/schemas/invitation.schema";
import type { InvitationPreview } from "@/features/users/services/invitation.service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Phase = "form" | "success" | "invalid";

export default function AcceptInvitationForm({ token, preview }: { token: string | null; preview: InvitationPreview }) {
  const [phase, setPhase] = useState<Phase>(token && preview ? "form" : "invalid");
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AcceptInvitationInput>({
    resolver: zodResolver(acceptInvitationSchema),
    defaultValues: { token: token ?? "", password: "", confirmPassword: "" },
  });

  const onSubmit = async (data: AcceptInvitationInput) => {
    setFormError(null);

    const result = await acceptInvitationAction(data);
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
        <h2 className="font-heading text-lg font-medium">Invitation unavailable</h2>
        <p className="text-sm text-slate-500">This invitation link is invalid, has expired, or has already been used.</p>
        <Button className="w-full" render={<Link href="/login" />}>
          Back to login
        </Button>
      </div>
    );
  }

  if (phase === "success") {
    return (
      <div className="flex flex-col gap-4 text-center">
        <h2 className="font-heading text-lg font-medium">You&apos;re all set</h2>
        <p className="text-sm text-slate-500">Your account has been created. Please sign in with your new password.</p>
        <Button className="w-full" render={<Link href="/login" />}>
          Go to login
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <input type="hidden" {...register("token")} />

      {preview && (
        <p className="text-sm text-slate-500">
          {preview.firstName} {preview.lastName} ({preview.email}) — invited to join {preview.companyName}.
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <Input id="password" type="password" autoComplete="new-password" {...register("password")} />
        {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="confirmPassword" className="text-sm font-medium">
          Confirm password
        </label>
        <Input id="confirmPassword" type="password" autoComplete="new-password" {...register("confirmPassword")} />
        {errors.confirmPassword && <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>}
      </div>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? "Setting up..." : "Accept invitation"}
      </Button>
    </form>
  );
}
