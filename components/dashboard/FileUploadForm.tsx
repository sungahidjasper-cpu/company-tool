"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { uploadFile } from "@/features/files/actions/file.actions";
import type { FileEntityType } from "@/features/files/schemas/file.schema";
import { Button } from "@/components/ui/button";

type FileUploadFormProps = {
  entityType: FileEntityType;
  entityId: string;
};

export default function FileUploadForm({
  entityType,
  entityId,
}: FileUploadFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const formData = new FormData(event.currentTarget);
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a file first.");
      return;
    }

    setIsSubmitting(true);
    const result = await uploadFile(formData);
    setIsSubmitting(false);

    if (!result.success) {
      setError(result.message);
      return;
    }

    formRef.current?.reset();
    toast.success("File uploaded");
    router.refresh();
  };

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="flex flex-wrap items-center gap-2"
    >
      <input type="hidden" name="entityType" value={entityType} />
      <input type="hidden" name="entityId" value={entityId} />
      <input type="file" name="file" className="text-sm" />
      <Button type="submit" size="sm" disabled={isSubmitting}>
        {isSubmitting ? "Uploading..." : "Upload"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
