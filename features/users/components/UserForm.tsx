"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { FieldPath, FieldValues, UseFormRegister } from "react-hook-form";
import { toast } from "sonner";

import {
  createUser,
  updateUser,
} from "@/features/users/actions/user.actions";
import {
  createUserSchema,
  updateUserSchema,
  type CreateUserInput,
  type UpdateUserInput,
} from "@/features/users/schemas/user.schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { User } from "@/lib/generated/prisma/client";

const ROLE_OPTIONS = ["EMPLOYEE", "MANAGER", "ADMIN", "SUPER_ADMIN"] as const;

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

type UserFormProps = {
  user?: Pick<User, "id" | "email" | "firstName" | "lastName" | "role">;
  canGrantSuperAdmin: boolean;
};

export default function UserForm({ user, canGrantSuperAdmin }: UserFormProps) {
  if (user) {
    return <EditUserForm user={user} canGrantSuperAdmin={canGrantSuperAdmin} />;
  }

  return <CreateUserForm canGrantSuperAdmin={canGrantSuperAdmin} />;
}

function RoleSelect<TFieldValues extends FieldValues & { role: string }>({
  register,
  canGrantSuperAdmin,
}: {
  register: UseFormRegister<TFieldValues>;
  canGrantSuperAdmin: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="role" className="text-sm font-medium">
        Role
      </label>
      <select
        id="role"
        className={selectClassName}
        {...register("role" as FieldPath<TFieldValues>)}
      >
        {ROLE_OPTIONS.filter(
          (role) => role !== "SUPER_ADMIN" || canGrantSuperAdmin
        ).map((role) => (
          <option key={role} value={role}>
            {role.replace("_", " ")}
          </option>
        ))}
      </select>
    </div>
  );
}

function CreateUserForm({
  canGrantSuperAdmin,
}: {
  canGrantSuperAdmin: boolean;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      email: "",
      firstName: "",
      lastName: "",
      password: "",
      role: "EMPLOYEE",
    },
  });

  const onSubmit = async (data: CreateUserInput) => {
    setFormError(null);
    const result = await createUser(data);

    if (!result.success) {
      setFormError(result.message);
      return;
    }

    toast.success("User created");
    router.push(`/users/${result.data.id}`);
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
        <label htmlFor="password" className="text-sm font-medium">
          Initial password
        </label>
        <Input id="password" type="password" {...register("password")} />
        {errors.password && (
          <p className="text-sm text-destructive">
            {errors.password.message}
          </p>
        )}
      </div>

      <RoleSelect register={register} canGrantSuperAdmin={canGrantSuperAdmin} />

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Creating..." : "Create user"}
      </Button>
    </form>
  );
}

function EditUserForm({
  user,
  canGrantSuperAdmin,
}: {
  user: NonNullable<UserFormProps["user"]>;
  canGrantSuperAdmin: boolean;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<UpdateUserInput>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: {
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
    },
  });

  const onSubmit = async (data: UpdateUserInput) => {
    setFormError(null);
    const result = await updateUser(user.id, data);

    if (!result.success) {
      setFormError(result.message);
      return;
    }

    toast.success("User updated");
    router.push(`/users/${user.id}`);
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
        <label className="text-sm font-medium">Email</label>
        <Input value={user.email} disabled />
      </div>

      <RoleSelect register={register} canGrantSuperAdmin={canGrantSuperAdmin} />

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving..." : "Save changes"}
      </Button>
    </form>
  );
}
