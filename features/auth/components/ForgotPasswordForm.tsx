"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { requestPasswordResetAction } from "@/features/auth/actions/password-reset.actions";
import {
  forgotPasswordSchema,
  type ForgotPasswordInput,
} from "@/features/auth/schemas/password-reset.schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function ForgotPasswordForm() {
  const [submitted, setSubmitted] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = async (data: ForgotPasswordInput) => {
    // Always shown on success, regardless of what requestPasswordResetAction
    // actually did server-side — that's the whole anti-enumeration point.
    const result = await requestPasswordResetAction(data);
    if (result.success) {
      setSubmitted(true);
    }
    // A validation-only failure (malformed email) simply re-renders the
    // form with react-hook-form's own client-side error — reveals nothing
    // about account existence since it never reached the server check.
  };

  if (submitted) {
    return (
      <div className="flex flex-col gap-4 text-center">
        <h2 className="font-heading text-lg font-medium">Check your email</h2>
        <p className="text-sm text-slate-500">
          If an account exists for that email address, we&apos;ve sent instructions to reset your password.
        </p>
        <p className="text-sm text-slate-500">The reset link will expire after a short period.</p>
        <Link href="/login" className="text-sm text-slate-500 hover:underline">
          ← Back to login
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <p className="text-sm text-slate-500">Enter the email address associated with your account.</p>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <Input id="email" type="email" autoComplete="email" {...register("email")} />
        {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
      </div>

      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? "Sending..." : "Send reset link"}
      </Button>

      <Link href="/login" className="text-center text-sm text-slate-500 hover:underline">
        ← Back to login
      </Link>
    </form>
  );
}
