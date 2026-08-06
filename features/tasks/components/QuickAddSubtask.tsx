"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { createSubtask } from "@/features/tasks/actions/task.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type QuickAddSubtaskProps = {
  parentTaskId: string;
};

export default function QuickAddSubtask({ parentTaskId }: QuickAddSubtaskProps) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (title.trim().length < 2) {
      setError("Title must be at least 2 characters.");
      return;
    }

    setIsSubmitting(true);
    const result = await createSubtask(parentTaskId, title.trim());
    setIsSubmitting(false);

    if (!result.success) {
      setError(result.message);
      return;
    }

    setTitle("");
    toast.success("Subtask added");
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <Input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Add a subtask..."
      />
      <Button type="submit" size="sm" disabled={isSubmitting}>
        {isSubmitting ? "Adding..." : "Add"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
