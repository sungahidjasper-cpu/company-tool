"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { linkKnowledgeSourceToSeoProject } from "@/features/seo/actions/knowledge-source.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

type LinkKnowledgeSourceFormProps = {
  seoProjectId: string;
  /** Active (non-archived) company sources not already linked to this project — an empty list means there's nothing left to offer. */
  availableSources: { id: string; title: string }[];
};

export default function LinkKnowledgeSourceForm({ seoProjectId, availableSources }: LinkKnowledgeSourceFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (availableSources.length === 0) {
    return <p className="text-sm text-slate-500">No unlinked knowledge sources available to add.</p>;
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const form = event.currentTarget;
    const formData = new FormData(form);
    const knowledgeSourceId = String(formData.get("knowledgeSourceId") ?? "");
    const note = String(formData.get("note") ?? "").trim() || undefined;
    if (!knowledgeSourceId) return;

    startTransition(async () => {
      const result = await linkKnowledgeSourceToSeoProject({ knowledgeSourceId, seoProjectId, note });
      if (!result.success) {
        setError(result.message);
        return;
      }
      toast.success("Knowledge source linked");
      form.reset();
      router.refresh();
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <select name="knowledgeSourceId" className={selectClassName} defaultValue={availableSources[0]?.id} aria-label="Knowledge source to link">
          {availableSources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.title}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Linking..." : "Link"}
        </Button>
      </div>
      <Input name="note" placeholder="Optional note — why this source supports this project" />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
