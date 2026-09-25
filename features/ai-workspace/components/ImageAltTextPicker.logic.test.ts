import { describe, expect, it } from "vitest";

import {
  ALT_TEXT_NULL_RESULT_MESSAGE,
  buildAltTextRequest,
  computeCanGenerateAltText,
  describeImageOption,
  NO_IMAGES_MESSAGE,
  NO_VISION_NOTICE,
  SELECT_PROJECT_HINT,
  type ImageOption,
} from "@/features/ai-workspace/components/ImageAltTextPicker";
import { formatAltTextForCopy } from "@/features/ai-workspace/components/ImageAltTextReview";
import {
  buildDecorativeRecommendation,
  DECORATIVE_ALT_TEXT,
  DESCRIPTION_REQUIRED_MESSAGE,
  hasEnoughImageEvidence,
  type ImageAltTextResult,
} from "@/features/ai-workspace/schemas/image-alt-text.schema";

/**
 * This repository has no React rendering test setup (vitest runs
 * `environment: "node"`), so the picker's real logic is tested as pure
 * functions — the same approach every other AI Workspace picker uses.
 */

const PROJECT_ID = "01a002a5-ffa5-705e-9731-806267514305";
const FILE_ID = "01a002a5-ffa5-705e-9731-8062675143ae";
const DESCRIPTION = "A person at a desk reviewing a spreadsheet.";

const ATTACHED: ImageOption = { id: FILE_ID, fileName: "desk-photo.png", mimeType: "image/png", contentId: "c1", contentTitle: "How Self Storage Investing Works" };
const LOOSE: ImageOption = { id: FILE_ID, fileName: "banner.webp", mimeType: "image/webp", contentId: null, contentTitle: null };

const RESULT: ImageAltTextResult = {
  altText: "A person at a desk reviewing a spreadsheet on a laptop.",
  reasoning: "Described exactly what the user reported.",
  accessibilityNote: "Consider whether this image is decorative.",
  lengthGuidance: "",
  characterCount: 54,
};

describe("hasEnoughImageEvidence — only the user's description counts", () => {
  it("1. a written description is enough", () => {
    expect(hasEnoughImageEvidence({ imageDescription: DESCRIPTION })).toBe(true);
  });

  it("2. nothing, empty, or whitespace is not enough", () => {
    expect(hasEnoughImageEvidence({})).toBe(false);
    expect(hasEnoughImageEvidence({ imageDescription: "" })).toBe(false);
    expect(hasEnoughImageEvidence({ imageDescription: "   \n " })).toBe(false);
  });
});

describe("computeCanGenerateAltText — the Generate gate", () => {
  it("3. enabled with a project, an image and a description", () => {
    expect(computeCanGenerateAltText(PROJECT_ID, FILE_ID, DESCRIPTION, false)).toBe(true);
  });

  it("4. blocked with no project selected — the tool never defaults to one", () => {
    expect(computeCanGenerateAltText("", FILE_ID, DESCRIPTION, false)).toBe(false);
    expect(computeCanGenerateAltText("   ", FILE_ID, DESCRIPTION, false)).toBe(false);
  });

  it("5. blocked with no image selected", () => {
    expect(computeCanGenerateAltText(PROJECT_ID, "", DESCRIPTION, false)).toBe(false);
  });

  it("6. blocked without a description — there is no other evidence of image contents", () => {
    expect(computeCanGenerateAltText(PROJECT_ID, FILE_ID, "", false)).toBe(false);
    expect(computeCanGenerateAltText(PROJECT_ID, FILE_ID, "   ", false)).toBe(false);
  });

  it("7. blocked for a DECORATIVE image — its answer is fixed, so no generation is spent", () => {
    expect(computeCanGenerateAltText(PROJECT_ID, FILE_ID, DESCRIPTION, true)).toBe(false);
  });
});

describe("decorative images", () => {
  it("8. the recommended alt text is genuinely empty", () => {
    expect(buildDecorativeRecommendation().altText).toBe("");
    expect(DECORATIVE_ALT_TEXT).toBe("");
  });

  it("9. the recommendation names the empty alt attribute explicitly", () => {
    expect(buildDecorativeRecommendation().recommendation).toContain('alt=""');
  });

  it("10. it explains why an empty alt differs from omitting the attribute", () => {
    expect(buildDecorativeRecommendation().recommendation).toMatch(/Leaving the attribute off entirely is not the same/);
    expect(buildDecorativeRecommendation().recommendation).toMatch(/read the file name aloud/);
  });

  it("11. it never invents a description for a decorative image", () => {
    const { altText, recommendation } = buildDecorativeRecommendation();
    expect(altText).toBe("");
    expect(recommendation).not.toMatch(/shows|depicts|photograph of/i);
  });

  it("12. it is deterministic — the same answer every time, with no model involved", () => {
    expect(buildDecorativeRecommendation()).toEqual(buildDecorativeRecommendation());
  });
});

describe("buildAltTextRequest", () => {
  it("13. trims the description and sends blank optional context as undefined", () => {
    expect(buildAltTextRequest(PROJECT_ID, FILE_ID, "  " + DESCRIPTION + "  ", "   ")).toEqual({
      seoProjectId: PROJECT_ID,
      fileId: FILE_ID,
      imageDescription: DESCRIPTION,
      additionalContext: undefined,
    });
  });

  it("14. keeps additional context the user did supply", () => {
    expect(buildAltTextRequest(PROJECT_ID, FILE_ID, DESCRIPTION, "  The sign reads OPEN  ").additionalContext).toBe("The sign reads OPEN");
  });

  it("15. carries ids and the user's words only — no company, file name or mime type", () => {
    const request = buildAltTextRequest(PROJECT_ID, FILE_ID, DESCRIPTION, "");
    expect(Object.keys(request).sort()).toEqual(["additionalContext", "fileId", "imageDescription", "seoProjectId"]);
    expect(JSON.stringify(request)).not.toMatch(/companyId|userId|role|fileName|mimeType/i);
  });
});

describe("describeImageOption — what the picker shows", () => {
  it("16. shows the file name, a readable type, and the page it belongs to", () => {
    expect(describeImageOption(ATTACHED)).toBe('desk-photo.png — PNG — on "How Self Storage Investing Works"');
  });

  it("17. omits the page when the image is not attached to one", () => {
    expect(describeImageOption(LOOSE)).toBe("banner.webp — WebP");
  });

  it("18. never exposes the internal file id or storage path", () => {
    for (const image of [ATTACHED, LOOSE]) {
      expect(describeImageOption(image)).not.toContain(image.id);
      expect(describeImageOption(image)).not.toMatch(/uploads\/|[0-9a-f]{8}-[0-9a-f]{4}/i);
    }
  });

  it("19. renders each supported type with a readable label", () => {
    expect(describeImageOption({ ...LOOSE, mimeType: "image/jpeg" })).toContain("JPEG");
    expect(describeImageOption({ ...LOOSE, mimeType: "image/gif" })).toContain("GIF");
  });
});

describe("formatAltTextForCopy — the Copy output", () => {
  it("20. copies the alt text and nothing else", () => {
    expect(formatAltTextForCopy(RESULT)).toBe(RESULT.altText);
  });

  it("21. excludes the reviewer-only reasoning, the note, the count and the guidance", () => {
    const copied = formatAltTextForCopy(RESULT);
    expect(copied).not.toContain(RESULT.reasoning);
    expect(copied).not.toContain(RESULT.accessibilityNote);
    expect(copied).not.toContain("54");
    expect(copied).not.toMatch(/characters|Reasoning|Accessibility/i);
  });

  it("22. carries no label or prefix — it goes straight into an alt attribute", () => {
    expect(formatAltTextForCopy(RESULT)).not.toMatch(/^alt=|^Alt text:/i);
  });

  it("23. never leaks ids or provider names", () => {
    const copied = formatAltTextForCopy(RESULT);
    expect(copied).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(copied).not.toMatch(/jobId|fileId|companyId|gemini|openrouter|ollama/i);
  });
});

describe("user-facing messages — the no-vision contract", () => {
  it("24. the description notice states plainly that the AI cannot see the image", () => {
    expect(NO_VISION_NOTICE).toContain("The AI cannot see the image");
    expect(NO_VISION_NOTICE).toContain("Describe what the image shows");
  });

  it("25. no message anywhere claims the AI analyses, views or inspects the image", () => {
    for (const message of [NO_VISION_NOTICE, SELECT_PROJECT_HINT, NO_IMAGES_MESSAGE, DESCRIPTION_REQUIRED_MESSAGE, ALT_TEXT_NULL_RESULT_MESSAGE]) {
      expect(message).not.toMatch(/analys\w*\s+your\s+image|AI vision|image analysis|scans? the image|reads? the image|looks? at the image/i);
    }
  });

  it("26. the empty-inventory message states the fact and says what to do, without implying an error", () => {
    expect(NO_IMAGES_MESSAGE).toContain("no images yet");
    expect(NO_IMAGES_MESSAGE).toMatch(/Upload an image/);
    expect(NO_IMAGES_MESSAGE).not.toMatch(/error|failed|unable|problem/i);
  });

  it("27. the null-result message blames the output, never the user's description", () => {
    expect(ALT_TEXT_NULL_RESULT_MESSAGE).toMatch(/didn't meet our accuracy requirements/);
    expect(ALT_TEXT_NULL_RESULT_MESSAGE).not.toMatch(/your description was|not enough|insufficient/i);
  });

  it("28. the description-required message is distinct from the generation-failure message", () => {
    expect(DESCRIPTION_REQUIRED_MESSAGE).not.toBe(ALT_TEXT_NULL_RESULT_MESSAGE);
  });
});
