type NoteItem = {
  id: string;
  body: string;
  createdAt: Date;
  author: { firstName: string; lastName: string };
};

type NotesListProps = {
  notes: NoteItem[];
};

export default function NotesList({ notes }: NotesListProps) {
  if (notes.length === 0) {
    return <p className="text-sm text-slate-500">No notes yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {notes.map((note) => (
        <li key={note.id} className="rounded-lg border border-slate-200 p-3">
          <p className="text-sm whitespace-pre-wrap">{note.body}</p>
          <p className="mt-2 text-xs text-slate-400">
            {note.author.firstName} {note.author.lastName} ·{" "}
            {note.createdAt.toLocaleString()}
          </p>
        </li>
      ))}
    </ul>
  );
}
