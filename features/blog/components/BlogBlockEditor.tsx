"use client";

import {
  Bold,
  ChevronDown,
  ChevronUp,
  Code2,
  Heading2,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Plus,
  Quote,
  Strikethrough,
  Table as TableIcon,
  Trash2,
  Type,
  Video as VideoIcon,
} from "lucide-react";
import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import type { HeadingLevel, MarkdownBlock } from "@/features/ai-workspace/services/markdown-preview.service";
import { uploadFile } from "@/features/files/actions/file.actions";
import { IMAGE_MIME_TYPES, MAX_FILE_SIZE_BYTES, VIDEO_MIME_TYPES } from "@/features/files/schemas/file.schema";
import { cn } from "@/lib/utils";

const inputClassName =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const bodyClassName =
  "w-full min-w-0 resize-y rounded-lg border border-transparent bg-transparent px-2.5 py-1.5 text-base leading-relaxed text-slate-800 outline-none hover:border-slate-200 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * Phase 7 — the article canvas.
 *
 * A block editor rather than one big textarea: the article is a list of typed
 * blocks, which is what makes an image a real part of the document at a real
 * position instead of an attachment shown beside it. Every block serializes
 * to plain Markdown, which stays the canonical stored format, so nothing
 * downstream — the AI tools, the WordPress publisher, revisions — has to
 * learn a new representation.
 *
 * No editor dependency was added. The formatting controls write Markdown into
 * the block's own text, which is the smallest thing that can round-trip.
 */

type EditorProps = {
  blocks: MarkdownBlock[];
  onChange: (blocks: MarkdownBlock[]) => void;
  /** Images attach to the saved Content record, so uploads need one to exist. */
  contentId: string | null;
  onNeedsSave: () => void;
  disabled?: boolean;
};

const INSERTABLE = [
  { kind: "paragraph", label: "Paragraph", icon: Type },
  { kind: "heading", label: "Heading", icon: Heading2 },
  { kind: "ul", label: "Bulleted list", icon: List },
  { kind: "ol", label: "Numbered list", icon: ListOrdered },
  { kind: "image", label: "Image", icon: ImageIcon },
  { kind: "video", label: "Video", icon: VideoIcon },
  { kind: "quote", label: "Quote", icon: Quote },
  { kind: "table", label: "Table", icon: TableIcon },
  { kind: "code", label: "Code", icon: Code2 },
  { kind: "divider", label: "Divider", icon: Minus },
] as const;

function blankBlock(kind: (typeof INSERTABLE)[number]["kind"]): MarkdownBlock {
  switch (kind) {
    case "heading":
      return { type: "heading", level: 2, text: "" };
    case "ul":
      return { type: "ul", items: [""] };
    case "ol":
      return { type: "ol", items: [""] };
    case "image":
      return { type: "image", src: "", alt: "", caption: null };
    case "video":
      return { type: "video", src: "" };
    case "quote":
      return { type: "quote", lines: [""] };
    case "table":
      return { type: "table", headers: ["Column 1", "Column 2"], rows: [["", ""]] };
    case "code":
      return { type: "code", language: null, lines: [""] };
    case "divider":
      return { type: "divider" };
    default:
      return { type: "paragraph", lines: [""] };
  }
}

/** Wraps the current selection in a Markdown marker, or inserts a template when nothing is selected. */
function applyInlineMark(textarea: HTMLTextAreaElement, marker: string, template: string): string {
  const { selectionStart, selectionEnd, value } = textarea;
  const selected = value.slice(selectionStart, selectionEnd);
  const replacement = selected.length > 0 ? `${marker}${selected}${marker}` : template;
  return value.slice(0, selectionStart) + replacement + value.slice(selectionEnd);
}

function InsertMenu({ onInsert, disabled }: { onInsert: (kind: (typeof INSERTABLE)[number]["kind"]) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative flex justify-center">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        aria-expanded={open}
        aria-label="Insert block"
        className="h-7 rounded-full px-2 text-xs"
      >
        <Plus size={13} /> Insert
      </Button>
      {open && (
        <div className="absolute top-8 z-20 grid w-64 grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg">
          {INSERTABLE.map((entry) => (
            <button
              key={entry.kind}
              type="button"
              onClick={() => {
                onInsert(entry.kind);
                setOpen(false);
              }}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100"
            >
              <entry.icon size={14} className="shrink-0 text-slate-500" />
              {entry.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BlogBlockEditor({ blocks, onChange, contentId, onNeedsSave, disabled }: EditorProps) {
  const [isUploading, startUpload] = useTransition();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploadTarget = useRef<{ index: number; kind: "image" | "video" } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function replaceBlock(index: number, block: MarkdownBlock) {
    onChange(blocks.map((current, i) => (i === index ? block : current)));
  }

  function insertAt(index: number, kind: (typeof INSERTABLE)[number]["kind"]) {
    const next = [...blocks];
    next.splice(index, 0, blankBlock(kind));
    onChange(next);
    if (kind === "image" || kind === "video") pickFile(index, kind);
  }

  function removeAt(index: number) {
    const next = blocks.filter((_, i) => i !== index);
    onChange(next.length > 0 ? next : [{ type: "paragraph", lines: [""] }]);
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  function pickFile(index: number, kind: "image" | "video") {
    setUploadError(null);
    if (!contentId) {
      setUploadError("Save the draft first — media attaches to the saved article.");
      onNeedsSave();
      return;
    }
    uploadTarget.current = { index, kind };
    fileInputRef.current?.click();
  }

  function handleFile(file: File) {
    const target = uploadTarget.current;
    if (!target || !contentId) return;

    const allowed = target.kind === "image" ? (IMAGE_MIME_TYPES as readonly string[]) : (VIDEO_MIME_TYPES as readonly string[]);
    if (!allowed.includes(file.type)) {
      setUploadError(`"${file.name}" is not a supported ${target.kind} type.`);
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setUploadError(`"${file.name}" is larger than the 10MB limit.`);
      return;
    }

    const formData = new FormData();
    formData.set("entityType", "content");
    formData.set("entityId", contentId);
    formData.set("file", file);

    startUpload(async () => {
      const result = await uploadFile(formData);
      if (!result.success) {
        setUploadError(result.message);
        return;
      }
      // The article references the File by its own served path, so the image
      // stays company-scoped and authorized by the existing route.
      const src = `/api/files/${result.data.id}`;
      const existing = blocks[target.index];
      replaceBlock(
        target.index,
        target.kind === "image"
          ? { type: "image", src, alt: existing?.type === "image" ? existing.alt : "", caption: existing?.type === "image" ? existing.caption : null }
          : { type: "video", src }
      );
      uploadTarget.current = null;
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept={[...IMAGE_MIME_TYPES, ...VIDEO_MIME_TYPES].join(",")}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) handleFile(file);
          event.target.value = "";
        }}
      />

      {uploadError && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{uploadError}</p>}

      <InsertMenu onInsert={(kind) => insertAt(0, kind)} disabled={disabled} />

      {blocks.map((block, index) => (
        <div key={index} className="flex flex-col gap-1">
          <div className="group/block relative flex min-w-0 gap-1 rounded-lg p-1">
            <div className="flex shrink-0 flex-col gap-0.5 pt-1 opacity-40 transition-opacity group-hover/block:opacity-100 focus-within:opacity-100">
              <button type="button" onClick={() => move(index, -1)} disabled={disabled || index === 0} className="rounded p-0.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30" aria-label="Move block up">
                <ChevronUp size={13} />
              </button>
              <button type="button" onClick={() => move(index, 1)} disabled={disabled || index === blocks.length - 1} className="rounded p-0.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30" aria-label="Move block down">
                <ChevronDown size={13} />
              </button>
              <button type="button" onClick={() => removeAt(index)} disabled={disabled} className="rounded p-0.5 text-slate-500 hover:bg-slate-100" aria-label="Delete block">
                <Trash2 size={13} />
              </button>
            </div>

            <div className="min-w-0 flex-1">
              <BlockEditor
                block={block}
                index={index}
                disabled={disabled || isUploading}
                onChange={(next) => replaceBlock(index, next)}
                onPickMedia={(kind) => pickFile(index, kind)}
              />
            </div>
          </div>

          <InsertMenu onInsert={(kind) => insertAt(index + 1, kind)} disabled={disabled} />
        </div>
      ))}
    </div>
  );
}

function BlockEditor({
  block,
  index,
  disabled,
  onChange,
  onPickMedia,
}: {
  block: MarkdownBlock;
  index: number;
  disabled?: boolean;
  onChange: (block: MarkdownBlock) => void;
  onPickMedia: (kind: "image" | "video") => void;
}) {
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  function mark(marker: string, template: string) {
    const textarea = textRef.current;
    if (!textarea) return;
    const value = applyInlineMark(textarea, marker, template);
    if (block.type === "paragraph") onChange({ type: "paragraph", lines: value.split("\n") });
    else if (block.type === "quote") onChange({ type: "quote", lines: value.split("\n") });
    else if (block.type === "heading") onChange({ ...block, text: value });
  }

  const supportsInline = block.type === "paragraph" || block.type === "quote" || block.type === "heading";

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {supportsInline && (
        <div className="flex flex-wrap items-center gap-0.5 opacity-0 transition-opacity group-hover/block:opacity-100 focus-within:opacity-100">
          {block.type === "heading" && (
            <select
              className="mr-1 h-6 rounded border border-slate-200 bg-white px-1 text-xs text-slate-700"
              value={block.level}
              onChange={(event) => onChange({ ...block, level: Number(event.target.value) as HeadingLevel })}
              disabled={disabled}
              aria-label="Heading level"
            >
              {[1, 2, 3, 4, 5, 6].map((level) => (
                <option key={level} value={level}>
                  H{level}
                </option>
              ))}
            </select>
          )}
          <ToolbarButton label="Bold" onClick={() => mark("**", "**bold**")} disabled={disabled}>
            <Bold size={13} />
          </ToolbarButton>
          <ToolbarButton label="Italic" onClick={() => mark("*", "*italic*")} disabled={disabled}>
            <Italic size={13} />
          </ToolbarButton>
          <ToolbarButton label="Strikethrough" onClick={() => mark("~~", "~~struck~~")} disabled={disabled}>
            <Strikethrough size={13} />
          </ToolbarButton>
          <ToolbarButton label="Inline code" onClick={() => mark("`", "`code`")} disabled={disabled}>
            <Code2 size={13} />
          </ToolbarButton>
          <ToolbarButton label="Link" onClick={() => mark("", "[link text](https://example.com)")} disabled={disabled}>
            <Link2 size={13} />
          </ToolbarButton>
        </div>
      )}

      {block.type === "heading" && (
        <textarea
          ref={textRef}
          rows={1}
          className={cn(bodyClassName, "font-semibold", block.level === 1 ? "text-2xl" : block.level === 2 ? "text-xl" : "text-lg")}
          value={block.text}
          placeholder={`Heading ${block.level}`}
          onChange={(event) => onChange({ ...block, text: event.target.value })}
          disabled={disabled}
          aria-label={`Heading level ${block.level}`}
        />
      )}

      {block.type === "paragraph" && (
        <textarea
          ref={textRef}
          rows={Math.max(2, block.lines.length)}
          className={bodyClassName}
          value={block.lines.join("\n")}
          placeholder="Write a paragraph…"
          onChange={(event) => onChange({ type: "paragraph", lines: event.target.value.split("\n") })}
          disabled={disabled}
          aria-label={`Paragraph ${index + 1}`}
        />
      )}

      {block.type === "quote" && (
        <textarea
          ref={textRef}
          rows={Math.max(2, block.lines.length)}
          className={cn(bodyClassName, "border-l-4 border-l-slate-300 italic")}
          value={block.lines.join("\n")}
          placeholder="A quote…"
          onChange={(event) => onChange({ type: "quote", lines: event.target.value.split("\n") })}
          disabled={disabled}
          aria-label="Quote"
        />
      )}

      {(block.type === "ul" || block.type === "ol") && (
        <textarea
          rows={Math.max(2, block.items.length)}
          className={bodyClassName}
          value={block.items.join("\n")}
          placeholder="One item per line"
          onChange={(event) => onChange({ type: block.type, items: event.target.value.split("\n") })}
          disabled={disabled}
          aria-label={block.type === "ul" ? "Bulleted list" : "Numbered list"}
        />
      )}

      {block.type === "code" && (
        <textarea
          rows={Math.max(3, block.lines.length)}
          className={cn(bodyClassName, "bg-slate-50 font-mono text-xs")}
          value={block.lines.join("\n")}
          placeholder="Code"
          onChange={(event) => onChange({ type: "code", language: block.language, lines: event.target.value.split("\n") })}
          disabled={disabled}
          aria-label="Code block"
        />
      )}

      {block.type === "divider" && <hr className="my-2 border-slate-200" />}

      {block.type === "image" && (
        <div className="flex flex-col gap-2 rounded-lg border border-slate-200 p-2">
          {block.src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={block.src} alt={block.alt} className="max-h-72 w-full rounded-md object-cover" />
          ) : (
            <div className="flex h-24 items-center justify-center rounded-md bg-slate-50 text-xs text-slate-500">No image selected yet</div>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Alt text</span>
              <input
                className={inputClassName}
                value={block.alt}
                placeholder="Describe the image for screen readers"
                onChange={(event) => onChange({ ...block, alt: event.target.value })}
                disabled={disabled}
                aria-label="Image alt text"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Caption</span>
              <input
                className={inputClassName}
                value={block.caption ?? ""}
                placeholder="Shown under the image"
                onChange={(event) => onChange({ ...block, caption: event.target.value || null })}
                disabled={disabled}
                aria-label="Image caption"
              />
            </label>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => onPickMedia("image")} disabled={disabled} className="self-start">
            <ImageIcon size={14} /> {block.src ? "Replace image" : "Upload image"}
          </Button>
        </div>
      )}

      {block.type === "video" && (
        <div className="flex flex-col gap-2 rounded-lg border border-slate-200 p-2">
          {block.src ? (
            <video src={block.src} controls className="max-h-72 w-full rounded-md" />
          ) : (
            <div className="flex h-24 items-center justify-center rounded-md bg-slate-50 text-xs text-slate-500">No video selected yet</div>
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => onPickMedia("video")} disabled={disabled} className="self-start">
            <VideoIcon size={14} /> {block.src ? "Replace video" : "Upload video"}
          </Button>
        </div>
      )}

      {block.type === "table" && <TableBlockEditor block={block} onChange={onChange} disabled={disabled} />}
    </div>
  );
}

function ToolbarButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="rounded p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function TableBlockEditor({
  block,
  onChange,
  disabled,
}: {
  block: Extract<MarkdownBlock, { type: "table" }>;
  onChange: (block: MarkdownBlock) => void;
  disabled?: boolean;
}) {
  function setHeader(index: number, value: string) {
    onChange({ ...block, headers: block.headers.map((header, i) => (i === index ? value : header)) });
  }
  function setCell(rowIndex: number, cellIndex: number, value: string) {
    onChange({
      ...block,
      rows: block.rows.map((row, r) => (r === rowIndex ? row.map((cell, c) => (c === cellIndex ? value : cell)) : row)),
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-200 p-2">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {block.headers.map((header, index) => (
                <th key={index} className="border border-slate-200 p-1">
                  <input className={inputClassName} value={header} onChange={(event) => setHeader(index, event.target.value)} disabled={disabled} aria-label={`Column ${index + 1} heading`} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="border border-slate-200 p-1">
                    <input className={inputClassName} value={cell} onChange={(event) => setCell(rowIndex, cellIndex, event.target.value)} disabled={disabled} aria-label={`Row ${rowIndex + 1} column ${cellIndex + 1}`} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => onChange({ ...block, rows: [...block.rows, block.headers.map(() => "")] })} disabled={disabled}>
          Add row
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange({ ...block, headers: [...block.headers, `Column ${block.headers.length + 1}`], rows: block.rows.map((row) => [...row, ""]) })}
          disabled={disabled}
        >
          Add column
        </Button>
      </div>
    </div>
  );
}
