"use client";

import { FileIcon, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { deleteFile } from "@/features/files/actions/file.actions";
import { Button } from "@/components/ui/button";

type FileItem = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: { firstName: string; lastName: string };
};

type FileListProps = {
  files: FileItem[];
  canDelete: boolean;
};

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FileList({ files, canDelete }: FileListProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleDelete = (id: string) => {
    if (!window.confirm("Delete this file?")) return;

    startTransition(async () => {
      const result = await deleteFile(id);
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      toast.success("File deleted");
      router.refresh();
    });
  };

  if (files.length === 0) {
    return <p className="text-sm text-slate-500">No files yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {files.map((file) => {
        const isImage = file.mimeType.startsWith("image/");

        return (
          <li
            key={file.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-2"
          >
            <a
              href={`/api/files/${file.id}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 overflow-hidden"
            >
              {isImage ? (
                // eslint-disable-next-line @next/next/no-img-element -- authenticated, dynamically-routed thumbnail, not a static asset
                <img
                  src={`/api/files/${file.id}`}
                  alt={file.fileName}
                  className="h-10 w-10 rounded object-cover"
                />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded bg-slate-100">
                  <FileIcon size={18} className="text-slate-500" />
                </div>
              )}
              <div className="overflow-hidden text-sm">
                <p className="truncate font-medium">{file.fileName}</p>
                <p className="text-xs text-slate-500">
                  {formatSize(file.sizeBytes)} · {file.uploadedBy.firstName}{" "}
                  {file.uploadedBy.lastName}
                </p>
              </div>
            </a>

            <div className="flex items-center gap-2">
              <a
                href={`/api/files/${file.id}?download=1`}
                className="text-sm text-slate-500 hover:underline"
              >
                Download
              </a>
              {canDelete && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={isPending}
                  onClick={() => handleDelete(file.id)}
                >
                  <Trash2 size={16} />
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
