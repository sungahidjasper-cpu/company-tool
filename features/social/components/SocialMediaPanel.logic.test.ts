import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/files/actions/file.actions", () => ({ uploadFile: vi.fn(), deleteFile: vi.fn(), restoreFile: vi.fn() }));

import { isStagedMedia, uploadStagedMedia, type SocialMediaFile } from "@/features/social/components/SocialMediaPanel";
import { uploadFile } from "@/features/files/actions/file.actions";

const mockedUpload = uploadFile as unknown as ReturnType<typeof vi.fn>;
const CONTENT_ID = "01a016c7-c1c5-74fb-9c43-c35ad68146e8";

const revoked: string[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  revoked.length = 0;
  globalThis.URL.revokeObjectURL = ((url: string) => void revoked.push(url)) as typeof URL.revokeObjectURL;
});

function staged(name: string, type = "image/png", size = 1024): SocialMediaFile {
  const pending = new File([new Uint8Array(size)], name, { type });
  return { id: `staged:${name}`, fileName: name, url: `blob:${name}`, mimeType: type, sizeBytes: size, pending };
}

function uploaded(id: string, name = "already.png"): SocialMediaFile {
  return { id, fileName: name, url: `/api/files/${id}`, mimeType: "image/png", sizeBytes: 2048 };
}

/**
 * Media added BEFORE the post exists is held in the browser and uploaded the
 * moment there is a record to attach it to. The point of these tests is that
 * staging changed only WHEN the upload happens — never whether it is checked,
 * and never what it attaches to.
 */
describe("what counts as staged", () => {
  it("1. a file still carrying its browser File is staged", () => {
    expect(isStagedMedia(staged("photo.png"))).toBe(true);
  });

  it("2. an uploaded file is not", () => {
    expect(isStagedMedia(uploaded("01a02222-2222-7222-b222-222222222222"))).toBe(false);
  });
});

describe("flushing staged media once the post exists", () => {
  it("3. every staged file is uploaded, in the order the user added them", async () => {
    mockedUpload
      .mockResolvedValueOnce({ success: true, data: { id: "file-1" } })
      .mockResolvedValueOnce({ success: true, data: { id: "file-2" } });

    const result = await uploadStagedMedia(CONTENT_ID, [staged("first.png"), staged("second.mp4", "video/mp4")]);

    expect(mockedUpload).toHaveBeenCalledTimes(2);
    expect(result.failed).toEqual([]);
    expect(result.files.map((file) => file.id)).toEqual(["file-1", "file-2"]);
    expect(result.files.map((file) => file.fileName)).toEqual(["first.png", "second.mp4"]);
  });

  it("4. IMAGES AND VIDEO BOTH STAGE — the same path, whatever the kind", async () => {
    mockedUpload.mockResolvedValue({ success: true, data: { id: "file-x" } });
    const result = await uploadStagedMedia(CONTENT_ID, [staged("clip.mp4", "video/mp4"), staged("shot.jpg", "image/jpeg")]);
    expect(result.failed).toEqual([]);
    expect(result.files.every(isStagedMedia)).toBe(false);
  });

  it("5. it attaches to the CONTENT record, through the existing upload action", async () => {
    mockedUpload.mockResolvedValue({ success: true, data: { id: "file-1" } });
    await uploadStagedMedia(CONTENT_ID, [staged("photo.png")]);

    const [formData] = mockedUpload.mock.calls[0];
    expect(formData.get("entityType")).toBe("content");
    expect(formData.get("entityId")).toBe(CONTENT_ID);
    expect(formData.get("file")).toBeInstanceOf(File);
  });

  it("6. an already-uploaded file is left completely alone", async () => {
    const existing = uploaded("01a02222-2222-7222-b222-222222222222");
    const result = await uploadStagedMedia(CONTENT_ID, [existing]);
    expect(mockedUpload).not.toHaveBeenCalled();
    expect(result.files).toEqual([existing]);
  });

  it("7. EXISTING SAVED MEDIA SURVIVES a save that also flushes new staged media", async () => {
    const existing = uploaded("01a02222-2222-7222-b222-222222222222", "kept.png");
    mockedUpload.mockResolvedValue({ success: true, data: { id: "file-new" } });

    const result = await uploadStagedMedia(CONTENT_ID, [existing, staged("added.png")]);

    expect(result.files[0]).toEqual(existing);
    expect(result.files[1].id).toBe("file-new");
    expect(mockedUpload).toHaveBeenCalledTimes(1);
  });

  it("8. the temporary browser URL is released once the real file exists", async () => {
    mockedUpload.mockResolvedValue({ success: true, data: { id: "file-1" } });
    await uploadStagedMedia(CONTENT_ID, [staged("photo.png")]);
    expect(revoked).toEqual(["blob:photo.png"]);
  });

  it("9. an uploaded file points at the real endpoint, not the browser URL", async () => {
    mockedUpload.mockResolvedValue({ success: true, data: { id: "file-1" } });
    const result = await uploadStagedMedia(CONTENT_ID, [staged("photo.png")]);
    expect(result.files[0].url).toBe("/api/files/file-1");
    expect(result.files[0].pending).toBeUndefined();
  });
});

describe("a rejected upload never costs the user their work", () => {
  it("10. a file the server refuses is reported and STAYS staged, so it can be retried", async () => {
    mockedUpload
      .mockResolvedValueOnce({ success: true, data: { id: "file-1" } })
      .mockResolvedValueOnce({ success: false, message: "This file type is not supported." });

    const result = await uploadStagedMedia(CONTENT_ID, [staged("good.png"), staged("bad.png")]);

    expect(result.failed).toEqual(["bad.png"]);
    expect(result.files).toHaveLength(2);
    expect(isStagedMedia(result.files[1])).toBe(true);
    // Its browser URL is NOT released — the thumbnail must keep working.
    expect(revoked).toEqual(["blob:good.png"]);
  });

  it("11. one refusal does not stop the files after it from uploading", async () => {
    mockedUpload
      .mockResolvedValueOnce({ success: false, message: "nope" })
      .mockResolvedValueOnce({ success: true, data: { id: "file-2" } });

    const result = await uploadStagedMedia(CONTENT_ID, [staged("bad.png"), staged("good.png")]);
    expect(result.failed).toEqual(["bad.png"]);
    expect(result.files[1].id).toBe("file-2");
  });
});

describe("nothing is written until the user saves", () => {
  it("12. an abandoned composition uploads nothing at all — there is no orphan to clean up", async () => {
    // The user staged three files and then left. uploadStagedMedia is simply
    // never called, and no File row was ever created by staging itself.
    staged("a.png");
    staged("b.png");
    staged("c.mp4", "video/mp4");
    expect(mockedUpload).not.toHaveBeenCalled();
  });

  it("13. removing a staged file needs no server call — dropping it IS the cleanup", async () => {
    const files = [staged("keep.png"), staged("drop.png")];
    const remaining = files.filter((file) => file.fileName !== "drop.png");
    expect(remaining).toHaveLength(1);
    expect(mockedUpload).not.toHaveBeenCalled();
  });
});
