"use client";

import { Film, ImagePlus, Trash2 } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { deleteFile, uploadFile } from "@/features/files/actions/file.actions";
import { IMAGE_MIME_TYPES, MAX_FILE_SIZE_BYTES, VIDEO_MIME_TYPES } from "@/features/files/schemas/file.schema";

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

const ACCEPTED = [...IMAGE_MIME_TYPES, ...VIDEO_MIME_TYPES];

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
 * Phase 6 — media for a social post, presented as a composer action rather
 * than a form field (Phase 7 refinement).
 *
 * Reuses the platform's EXISTING File infrastructure wholesale: the same
 * uploadFile/deleteFile actions, the same storage, the same size and MIME
 * rules, and the same company/permission checks. No second media library was
 * built.
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
  /**
   * Extra composer actions rendered in the SAME "Add to post" row.
   *
   * They live here rather than in the composer because the file input lives
   * here: handing the parent an imperative opener would mean touching a ref
   * during render, which is exactly the cascading-render problem the React
   * compiler flags. One row, one owner.
   */
  extraActions,
}: {
  contentId: string | null;
  files: SocialMediaFile[];
  onFilesChange: (files: SocialMediaFile[]) => void;
  disabled?: boolean;
  extraActions?: React.ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const kindRef = useRef<"image" | "video">("image");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function openPicker(kind: "image" | "video") {
    setError(null);
    kindRef.current = kind;
    inputRef.current?.click();
  }

  function add(file: File) {
    setError(null);

    const allowed = kindRef.current === "image" ? (IMAGE_MIME_TYPES as readonly string[]) : (VIDEO_MIME_TYPES as readonly string[]);
    if (!allowed.includes(file.type)) {
      setError(`"${file.name}" is not a supported ${kindRef.current === "image" ? "image" : "video"} type.`);
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

  const stagedCount = files.filter(isStagedMedia).length;

  return (
    <div className="flex flex-col gap-2">
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

      {files.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {files.map((file) => (
            <div key={file.id} className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200">
              <div className="flex h-24 items-center justify-center bg-slate-50">
                {file.mimeType.startsWith("video/") ? (
                  <video src={file.url} className="h-full w-full object-cover" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={file.url} alt={file.fileName} className="h-full w-full object-cover" />
                )}
              </div>
              <div className="flex min-w-0 items-center justify-between gap-1.5 px-2 py-1.5">
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
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
        <span className="text-xs font-medium text-slate-500">{isPending ? "Uploading…" : "Add to post"}</span>
        <Button type="button" variant="outline" size="sm" onClick={() => openPicker("image")} disabled={disabled || isPending}>
          <ImagePlus size={14} /> Photo or GIF
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => openPicker("video")} disabled={disabled || isPending}>
          <Film size={14} /> Video
        </Button>
        {extraActions}
      </div>

      {stagedCount > 0 && (
        <p className="text-xs text-slate-500">
          {stagedCount === 1 ? "1 file is" : `${stagedCount} files are`} ready and will be attached when you save this post.
        </p>
      )}
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
