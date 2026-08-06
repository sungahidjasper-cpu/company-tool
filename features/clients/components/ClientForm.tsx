"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  createClient,
  updateClient,
} from "@/features/clients/actions/client.actions";
import {
  clientSchema,
  type ClientInput,
} from "@/features/clients/schemas/client.schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Client } from "@/lib/generated/prisma/client";

const STATUS_OPTIONS = ["LEAD", "ACTIVE", "INACTIVE", "CHURNED"] as const;

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

type UserOption = { id: string; firstName: string; lastName: string };

type ClientFormProps = {
  client?: Pick<
    Client,
    | "id"
    | "name"
    | "email"
    | "phone"
    | "website"
    | "industry"
    | "address"
    | "source"
    | "status"
    | "ownerId"
  >;
  userOptions: UserOption[];
};

export default function ClientForm({ client, userOptions }: ClientFormProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ClientInput>({
    resolver: zodResolver(clientSchema),
    defaultValues: {
      name: client?.name ?? "",
      email: client?.email ?? "",
      phone: client?.phone ?? "",
      website: client?.website ?? "",
      industry: client?.industry ?? "",
      address: client?.address ?? "",
      source: client?.source ?? "",
      status: client?.status ?? "LEAD",
      ownerId: client?.ownerId ?? "",
    },
  });

  const onSubmit = async (data: ClientInput) => {
    setFormError(null);

    const result = client
      ? await updateClient(client.id, data)
      : await createClient(data);

    if (!result.success) {
      setFormError(result.message);
      return;
    }

    toast.success(client ? "Client updated" : "Client created");
    router.push(`/clients/${result.data.id}`);
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="name" className="text-sm font-medium">
          Name
        </label>
        <Input id="name" {...register("name")} />
        {errors.name && (
          <p className="text-sm text-destructive">{errors.name.message}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
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
          <label htmlFor="phone" className="text-sm font-medium">
            Phone
          </label>
          <Input id="phone" {...register("phone")} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="website" className="text-sm font-medium">
          Website
        </label>
        <Input id="website" {...register("website")} placeholder="https://" />
        {errors.website && (
          <p className="text-sm text-destructive">{errors.website.message}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="industry" className="text-sm font-medium">
            Industry
          </label>
          <Input id="industry" {...register("industry")} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="source" className="text-sm font-medium">
            Source
          </label>
          <Input id="source" {...register("source")} placeholder="e.g. Referral" />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="address" className="text-sm font-medium">
          Address
        </label>
        <Input id="address" {...register("address")} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="status" className="text-sm font-medium">
            Status
          </label>
          <select id="status" className={selectClassName} {...register("status")}>
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="ownerId" className="text-sm font-medium">
            Owner
          </label>
          <select id="ownerId" className={selectClassName} {...register("ownerId")}>
            <option value="">Unassigned</option>
            {userOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.firstName} {option.lastName}
              </option>
            ))}
          </select>
        </div>
      </div>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving..." : client ? "Save changes" : "Create client"}
      </Button>
    </form>
  );
}
