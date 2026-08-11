"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { generateReport } from "@/features/reports/actions/report.actions";
import {
  REPORT_TYPE_OPTIONS,
  generateReportSchema,
  getScopeKind,
  type GenerateReportInput,
} from "@/features/reports/schemas/report.schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

const textareaClassName =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

type EntityOption = { id: string; name: string };

type ReportFormProps = {
  clientOptions: EntityOption[];
  projectOptions: EntityOption[];
  seoProjectOptions: EntityOption[];
};

export default function ReportForm({
  clientOptions,
  projectOptions,
  seoProjectOptions,
}: ReportFormProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<GenerateReportInput>({
    resolver: zodResolver(generateReportSchema),
    defaultValues: {
      type: "PROJECT_SUMMARY",
      title: "",
      scopeId: "",
      notes: "",
    },
  });

  const selectedType = watch("type");
  const scopeKind = getScopeKind(selectedType);

  const onSubmit = async (data: GenerateReportInput) => {
    setFormError(null);

    const formData = new FormData();
    formData.set("type", data.type);
    formData.set("title", data.title);
    if (data.scopeId) formData.set("scopeId", data.scopeId);
    if (data.notes) formData.set("notes", data.notes);
    const file = fileInputRef.current?.files?.[0];
    if (file) formData.set("file", file);

    const result = await generateReport(formData);

    if (!result.success) {
      setFormError(result.message);
      return;
    }

    toast.success("Report generated");
    router.push(`/reports/${result.data.id}`);
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="type" className="text-sm font-medium">
          Report type
        </label>
        <select id="type" className={selectClassName} {...register("type")}>
          {REPORT_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="title" className="text-sm font-medium">
          Title
        </label>
        <Input id="title" {...register("title")} placeholder="e.g. Q3 Client Summary" />
        {errors.title && (
          <p className="text-sm text-destructive">{errors.title.message}</p>
        )}
      </div>

      {scopeKind === "client" && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="scopeId" className="text-sm font-medium">
            Client (optional — leave blank for company-wide)
          </label>
          <select id="scopeId" className={selectClassName} {...register("scopeId")}>
            <option value="">Company-wide</option>
            {clientOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {scopeKind === "project" && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="scopeId" className="text-sm font-medium">
            Project (optional — leave blank for company-wide)
          </label>
          <select id="scopeId" className={selectClassName} {...register("scopeId")}>
            <option value="">Company-wide</option>
            {projectOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {scopeKind === "seoProject" && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="scopeId" className="text-sm font-medium">
            SEO Project (optional — leave blank for company-wide)
          </label>
          <select id="scopeId" className={selectClassName} {...register("scopeId")}>
            <option value="">Company-wide</option>
            {seoProjectOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {scopeKind === "custom" && (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="notes" className="text-sm font-medium">
              Notes
            </label>
            <textarea
              id="notes"
              rows={4}
              className={textareaClassName}
              {...register("notes")}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="file" className="text-sm font-medium">
              Attach a file (optional)
            </label>
            <input id="file" type="file" ref={fileInputRef} className="text-sm" />
          </div>
        </>
      )}

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Generating..." : "Generate report"}
      </Button>
    </form>
  );
}
