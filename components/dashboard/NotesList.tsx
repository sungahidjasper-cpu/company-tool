"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";

type NoteItem = {
  id: string;
  body: string;
  createdAt: Date;
  /** id is optional: only entities migrated to Phase 26 Stage 3 select it — others keep working read-only, exactly as before. */
  author: { id?: string; firstName: string; lastName: string };
};

type NotesListProps = {
  notes: NoteItem[];
  /**
   * Phase 26 Stage 3 — all four are optional so any existing read-only
   * caller keeps working unchanged. currentUserId/canManage are only ever
   * used to decide which controls to RENDER; the real authorization check
   * always lives server-side, inside whatever action onEdit/onDelete calls.
   */
  currentUserId?: string;
  canManage?: boolean;
  onEdit?: (input: { noteId: string; body: string }) => Promise<ActionResult>;
  onDelete?: (input: { noteId: string }) => Promise<ActionResult>;
};

export default function NotesList({ notes, currentUserId, canManage, onEdit, onDelete }: NotesListProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  if (notes.length === 0) {
    return <p className="text-sm text-slate-500">No notes yet.</p>;
  }

  function startEdit(note: NoteItem) {
    setEditingId(note.id);
    setDraft(note.body);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft("");
  }

  function submitEdit(noteId: string) {
    if (!onEdit) return;
    startTransition(async () => {
      const result = await onEdit({ noteId, body: draft });
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      toast.success("Note updated");
      setEditingId(null);
      setDraft("");
      router.refresh();
    });
  }

  function handleDelete(noteId: string) {
    if (!onDelete) return;
    if (!window.confirm("Delete this note?")) return;

    startTransition(async () => {
      const result = await onDelete({ noteId });
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      toast.success("Note deleted");
      router.refresh();
    });
  }

  return (
    <ul className="flex flex-col gap-3">
      {notes.map((note) => {
        const canAct = Boolean((currentUserId && note.author.id === currentUserId) || canManage);
        const isEditing = editingId === note.id;

        return (
          <li key={note.id} className="rounded-lg border border-slate-200 p-3">
            {isEditing ? (
              <div className="flex flex-col gap-2">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  disabled={isPending}
                  className="min-h-20 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
                <div className="flex gap-2 self-end">
                  <Button type="button" variant="outline" size="sm" onClick={cancelEdit} disabled={isPending}>
                    Cancel
                  </Button>
                  <Button type="button" size="sm" onClick={() => submitEdit(note.id)} disabled={isPending}>
                    {isPending ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-sm whitespace-pre-wrap">{note.body}</p>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <p className="text-xs text-slate-400">
                    {note.author.firstName} {note.author.lastName} ·{" "}
                    {note.createdAt.toLocaleString()}
                  </p>
                  {canAct && (onEdit || onDelete) && (
                    <div className="flex gap-3">
                      {onEdit && (
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          className="h-auto p-0 text-xs"
                          onClick={() => startEdit(note)}
                          disabled={isPending}
                        >
                          Edit
                        </Button>
                      )}
                      {onDelete && (
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          className="h-auto p-0 text-xs text-destructive"
                          onClick={() => handleDelete(note.id)}
                          disabled={isPending}
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
