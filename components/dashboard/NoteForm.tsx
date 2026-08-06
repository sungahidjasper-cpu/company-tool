"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import type { ActionResult } from "@/lib/action-result";
import { Button } from "@/components/ui/button";

type NoteFormProps = {
  action: (body: string) => Promise<ActionResult>;
};

export default function NoteForm({ action }: NoteFormProps) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (body.trim().length === 0) {
      setError("Note cannot be empty.");
      return;
    }

    setIsSubmitting(true);
    const result = await action(body.trim());
    setIsSubmitting(false);

    if (!result.success) {
      setError(result.message);
      return;
    }

    setBody("");
    toast.success("Note added");
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Add a note..."
        className="min-h-20 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button
        type="submit"
        size="sm"
        disabled={isSubmitting}
        className="self-end"
      >
        {isSubmitting ? "Adding..." : "Add note"}
      </Button>
    </form>
  );
}
