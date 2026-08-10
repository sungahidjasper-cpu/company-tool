"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { updateProfile } from "@/features/profile/actions/profile.actions";
import {
  updateProfileSchema,
  type UpdateProfileInput,
} from "@/features/profile/schemas/profile.schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { User } from "@/lib/generated/prisma/client";
import { formatEnumLabel } from "@/lib/utils";

type ProfileFormProps = {
  user: Pick<
    User,
    "id" | "email" | "firstName" | "lastName" | "avatar" | "role"
  >;
};

export default function ProfileForm({ user }: ProfileFormProps) {
  const router = useRouter();
  const { update } = useSession();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: {
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      avatar: user.avatar ?? "",
    },
  });

  const onSubmit = async (data: UpdateProfileInput) => {
    setFormError(null);

    const result = await updateProfile(data);
    if (!result.success) {
      setFormError(result.message);
      return;
    }

    // Keeps the JWT (and therefore the header) in sync without a re-login —
    // the jwt callback merges this payload in on trigger === "update".
    await update({
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      avatar: data.avatar || null,
    });

    toast.success("Profile updated");
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="firstName" className="text-sm font-medium">
            First name
          </label>
          <Input id="firstName" {...register("firstName")} />
          {errors.firstName && (
            <p className="text-sm text-destructive">
              {errors.firstName.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="lastName" className="text-sm font-medium">
            Last name
          </label>
          <Input id="lastName" {...register("lastName")} />
          {errors.lastName && (
            <p className="text-sm text-destructive">
              {errors.lastName.message}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <Input id="email" type="email" {...register("email")} />
        {errors.email && (
          <p className="text-sm text-destructive">{errors.email.message}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="avatar" className="text-sm font-medium">
          Avatar URL (optional)
        </label>
        <Input id="avatar" placeholder="https://" {...register("avatar")} />
        {errors.avatar && (
          <p className="text-sm text-destructive">{errors.avatar.message}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">Role</label>
        <Input value={formatEnumLabel(user.role)} disabled />
      </div>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving..." : "Save changes"}
      </Button>
    </form>
  );
}
