"use client";

import { Film, ImagePlus, Trash2, UploadCloud } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { deleteFile, uploadFile } from "@/features/files/actions/file.actions";
import { IMAGE_MIME_TYPES, MAX_FILE_SIZE_BYTES, VIDEO_MIME_TYPES } from "@/features/files/schemas/file.schema";
import { cn } from "@/lib/utils";

export type SocialMediaFile = {
  /** A real File row id once uploaded; a `staged:` key while it is only in the browser. */
  id: string;
  fileName: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  /**
   * The browser File, present ONLY while this item is staged.
   *
   * Its presence is what makes an item staged — there is no separate flag to
   * fall out of step with it, and once the item is uploaded the field is gone.
   */
  pending?: File;
};

const ACCEPTED = [...IMAGE_MIME_TYPES, ...VIDEO_MIME_TYPES] as readonly string[];

export function isStagedMedia(file: SocialMediaFile): boolean {
  return file.pending !== undefined;
}

function readableSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Uploads everything that was staged while the post had no record yet.
 *
 * Called by the composer immediately after the Content row exists, through
 * the SAME `uploadFile` action every other upload in the app uses — so the
 * company check, the permission check, the MIME allow-list and the 10MB limit
 * all still run server-side, at the real upload, exactly as before. Staging
 * moved WHEN the upload happens, never WHETHER it is checked.
 *
 * Returns the new list plus any failures, rather than throwing: a caption that
 * saved correctly must not be reported as lost because one photo failed.
 */
export async function uploadStagedMedia(
  contentId: string,
  files: readonly SocialMediaFile[]
): Promise<{ files: SocialMediaFile[]; failed: string[] }> {
  const result: SocialMediaFile[] = [];
  const failed: string[] = [];

  for (const file of files) {
    if (!file.pending) {
      result.push(file);
      continue;
    }
    const formData = new FormData();
    formData.set("entityType", "content");
    formData.set("entityId", contentId);
    formData.set("file", file.pending);

    const uploaded = await uploadFile(formData);
    if (!uploaded.success) {
      failed.push(file.fileName);
      // Keep it staged so the user still has it and can retry by saving again.
      result.push(file);
      continue;
    }
    URL.revokeObjectURL(file.url);
    result.push({ id: uploaded.data.id, fileName: file.fileName, url: `/api/files/${uploaded.data.id}`, mimeType: file.mimeType, sizeBytes: file.sizeBytes });
  }

  return { files: result, failed };
}

/**
 * Phase 6 media, redesigned media-first for the composer's UX pass.
 *
 * Reuses the platform's EXISTING File infrastructure wholesale: the same
 * uploadFile/deleteFile actions, the same storage, the same size and MIME
 * rules, and the same company/permission checks. No second media library was
 * built, and drag-and-drop is a second way to reach the exact same `add()`
 * this always had — not a second upload path.
 *
 * TWO MODES, because a File row needs something to attach to:
 *
 *   - No saved post yet → the file is held in the browser and uploaded the
 *     moment the post is saved. Nothing is written, so an abandoned draft
 *     leaves nothing behind to orphan or clean up.
 *   - Already saved → uploaded immediately, as before, so finished work is
 *     never held hostage to another Save.
 *
 * The user is told which state a file is in, but is never asked to save first
 * in order to continue composing.
 */
export default function SocialMediaPanel({
  contentId,
  files,
  onFilesChange,
  disabled,
}: {
  contentId: string | null;
  files: SocialMediaFile[];
  onFilesChange: (files: SocialMediaFile[]) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const kindRef = useRef<"image" | "video">("image");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  function openPicker(kind: "image" | "video") {
    setError(null);
    kindRef.current = kind;
    inputRef.current?.click();
  }

  function add(file: File) {
    setError(null);

    /*
     * Checked against the FULL accepted list, not just whichever button was
     * clicked — the file input's own `accept` attribute already allows both
     * kinds no matter which button opened it, and a dropped file was never
     * routed through a button at all. One real rule, checked once.
     */
    if (!ACCEPTED.includes(file.type)) {
      setError(`"${file.name}" is not a supported photo, GIF, or video type.`);
      return;
    }
    /*
     * Checked here for a fast, clear message, and checked AGAIN on the server
     * whenever the upload actually happens. Staging does not move the
     * boundary: this is convenience, the server is the rule.
     */
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError(`"${file.name}" is larger than the 10MB limit.`);
      return;
    }

    // Nothing saved yet: keep the file in the browser and show it immediately.
    if (!contentId) {
      onFilesChange([
        ...files,
        { id: `staged:${file.name}:${file.size}:${Date.now()}`, fileName: file.name, url: URL.createObjectURL(file), mimeType: file.type, sizeBytes: file.size, pending: file },
      ]);
      return;
    }

    const formData = new FormData();
    formData.set("entityType", "content");
    formData.set("entityId", contentId);
    formData.set("file", file);

    startTransition(async () => {
      const result = await uploadFile(formData);
      if (!result.success) {
        setError(result.message);
        return;
      }
      onFilesChange([
        ...files,
        { id: result.data.id, fileName: file.name, url: URL.createObjectURL(file), mimeType: file.type, sizeBytes: file.size },
      ]);
      toast.success("Media added");
    });
  }

  function remove(file: SocialMediaFile) {
    setError(null);

    // A staged file was never written anywhere — dropping it IS the cleanup.
    if (file.pending) {
      URL.revokeObjectURL(file.url);
      onFilesChange(files.filter((candidate) => candidate.id !== file.id));
      return;
    }

    startTransition(async () => {
      const result = await deleteFile(file.id);
      if (!result.success) {
        setError(result.message);
        return;
      }
      onFilesChange(files.filter((candidate) => candidate.id !== file.id));
      toast.success("Media removed");
    });
  }

  /** Drag-and-drop is a second way to reach `add()` — same validation, same staging, same upload. */
  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDraggingOver(false);
    if (disabled || isPending) return;
    Array.from(event.dataTransfer.files).forEach((file) => add(file));
  }

  const stagedCount = files.filter(isStagedMedia).length;

  return (
    <div
      className="flex flex-col gap-3"
      onDragOver={(event) => {
        if (disabled || isPending) return;
        event.preventDefault();
        setIsDraggingOver(true);
      }}
      onDragLeave={() => setIsDraggingOver(false)}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(",")}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) add(file);
          event.target.value = "";
        }}
      />

      {files.length === 0 ? (
        /*
         * Media-first empty state — a real drop target, not just a row of
         * small buttons underneath a textarea. Dragging a file anywhere onto
         * this panel (not only inside this box) reaches the same `add()`.
         */
        <div
          className={cn(
            "flex flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
            isDraggingOver ? "border-[#2F4156] bg-[#2F4156]/5" : "border-slate-200 bg-slate-50"
          )}
        >
          <span className="flex size-11 items-center justify-center rounded-full bg-white shadow-sm">
            <UploadCloud size={20} className="text-slate-400" />
          </span>
          <div>
            <p className="text-sm font-medium text-slate-700">Add photos or videos</p>
            <p className="text-xs text-slate-500">Drag and drop here, or choose a file below.</p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={() => openPicker("image")} disabled={disabled || isPending}>
              <ImagePlus size={14} /> Photo or GIF
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => openPicker("video")} disabled={disabled || isPending}>
              <Film size={14} /> Video
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Media IS the point of this panel now — one attachment fills the width instead of sitting in a small grid tile. */}
          <div className={cn("grid gap-2.5", files.length === 1 ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-3")}>
            {files.map((file) => (
              <div key={file.id} className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className={cn("flex items-center justify-center bg-slate-50", files.length === 1 ? "h-64" : "h-36")}>
                  {file.mimeType.startsWith("video/") ? (
                    <video src={file.url} controls className="h-full w-full object-cover" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={file.url} alt={file.fileName} className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="flex min-w-0 items-center justify-between gap-1.5 px-2.5 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-[11px] font-medium text-slate-700">{file.fileName}</span>
                    <span className="block text-[10px] text-slate-400">{readableSize(file.sizeBytes)}</span>
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => remove(file)}
                    disabled={disabled || isPending}
                    aria-label={`Remove ${file.fileName}`}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-500">{isPending ? "Uploading…" : "Add more"}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => openPicker("image")} disabled={disabled || isPending}>
              <ImagePlus size={14} /> Photo or GIF
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => openPicker("video")} disabled={disabled || isPending}>
              <Film size={14} /> Video
            </Button>
          </div>
        </>
      )}

      {isDraggingOver && files.length > 0 && (
        <p className="rounded-lg border border-dashed border-[#2F4156] bg-[#2F4156]/5 px-3 py-2 text-center text-xs font-medium text-[#2F4156]">
          Drop to add another file
        </p>
      )}

      {stagedCount > 0 && (
        <p className="text-xs text-slate-500">
          {stagedCount === 1 ? "1 file is" : `${stagedCount} files are`} ready and will be attached when you save this post.
        </p>
      )}
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
