"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { importKeywordsCsv } from "@/features/seo/actions/keyword.actions";
import { Button } from "@/components/ui/button";

type KeywordImportFormProps = {
  seoProjectId: string;
};

type ImportSummary = { created: number; errors: { row: number; message: string }[] };

export default function KeywordImportForm({ seoProjectId }: KeywordImportFormProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSummary(null);

    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("Choose a CSV file first.");
      return;
    }

    const formData = new FormData();
    formData.set("file", file);

    setIsSubmitting(true);
    const result = await importKeywordsCsv(seoProjectId, formData);
    setIsSubmitting(false);

    if (!result.success) {
      setError(result.message);
      return;
    }

    setSummary(result.data);
    if (fileInputRef.current) fileInputRef.current.value = "";
    toast.success(`Imported ${result.data.created} keyword(s)`);
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <p className="text-xs text-slate-500">
        Columns: term (required), searchVolume, difficulty, currentRank, targetUrl,
        cluster, intent, priority, status.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="text-sm" />
        <Button type="submit" size="sm" disabled={isSubmitting}>
          {isSubmitting ? "Importing..." : "Import CSV"}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {summary && (
        <div className="text-sm">
          <p className="font-medium">{summary.created} keyword(s) imported.</p>
          {summary.errors.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-slate-500">
              {summary.errors.map((err, index) => (
                <li key={index}>
                  Row {err.row}: {err.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
