import { describe, expect, it } from "vitest";

import { PROJECT_IMAGE_WHERE } from "@/features/ai-workspace/services/project-image-inventory";
import { ALLOWED_MIME_TYPES, IMAGE_MIME_TYPES, isImageMimeType } from "@/features/files/schemas/file.schema";

const PROJECT_ID = "01a002a5-ffa5-705e-9731-806267514305";

/**
 * The inventory filter is the single rule the route, the action and the
 * dispatcher all share, so it is asserted directly rather than only through
 * a database round-trip.
 */

describe("IMAGE_MIME_TYPES — the four supported image types", () => {
  it("1. covers exactly JPEG, PNG, WebP and GIF", () => {
    expect([...IMAGE_MIME_TYPES]).toEqual(["image/jpeg", "image/png", "image/webp", "image/gif"]);
  });

  it("2. accepts each supported image type", () => {
    for (const mime of ["image/jpeg", "image/png", "image/webp", "image/gif"]) {
      expect(isImageMimeType(mime)).toBe(true);
    }
  });

  it("3. rejects every non-image type the platform otherwise allows", () => {
    for (const mime of ALLOWED_MIME_TYPES.filter((m) => !(IMAGE_MIME_TYPES as readonly string[]).includes(m))) {
      expect(isImageMimeType(mime)).toBe(false);
    }
  });

  it("4. rejects specific document, spreadsheet, archive and text types by name", () => {
    for (const mime of ["application/pdf", "text/csv", "text/plain", "application/zip", "application/msword"]) {
      expect(isImageMimeType(mime)).toBe(false);
    }
  });

  it("5. rejects an image type the platform does not support", () => {
    for (const mime of ["image/svg+xml", "image/bmp", "image/tiff", "image/avif"]) {
      expect(isImageMimeType(mime)).toBe(false);
    }
  });

  it("6. stays a subset of ALLOWED_MIME_TYPES — the two lists cannot drift apart", () => {
    for (const mime of IMAGE_MIME_TYPES) {
      expect(ALLOWED_MIME_TYPES).toContain(mime);
    }
  });
});

describe("PROJECT_IMAGE_WHERE — the shared inventory filter", () => {
  const where = PROJECT_IMAGE_WHERE(PROJECT_ID);

  it("7. excludes soft-deleted files", () => {
    expect(where.deletedAt).toBeNull();
  });

  it("8. restricts to image MIME types only", () => {
    expect(where.mimeType).toEqual({ in: ["image/jpeg", "image/png", "image/webp", "image/gif"] });
  });

  it("9. accepts files attached DIRECTLY to the project", () => {
    expect(where.OR).toContainEqual({ seoProjectId: PROJECT_ID });
  });

  it("10. accepts files attached to the project's Content, resolved through the relation", () => {
    // A file uploaded against a Content record carries contentId and leaves
    // seoProjectId null, so the project link must be resolved via Content.
    expect(where.OR).toContainEqual({ content: { seoProjectId: PROJECT_ID, deletedAt: null } });
  });

  it("11. excludes files whose Content has been trashed", () => {
    const contentBranch = where.OR.find((clause) => "content" in clause) as { content: { deletedAt: null } };
    expect(contentBranch.content.deletedAt).toBeNull();
  });

  it("12. every branch is scoped by the project id — nothing is unscoped", () => {
    const serialized = JSON.stringify(where.OR);
    expect(where.OR).toHaveLength(2);
    expect(serialized.split(PROJECT_ID).length - 1).toBe(2);
  });

  it("13. a DIFFERENT project id produces a filter that shares no scope with this one", () => {
    const other = PROJECT_IMAGE_WHERE("01a002a5-ffa5-705e-9731-806267514399");
    expect(JSON.stringify(other.OR)).not.toContain(PROJECT_ID);
  });

  it("14. carries no company clause — ownership comes from the already-verified project, not a client value", () => {
    expect(JSON.stringify(where)).not.toContain("companyId");
  });
});
