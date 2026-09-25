import { describe, expect, it } from "vitest";

import {
  buildImageAltTextResult,
  buildLengthGuidance,
  buildPrompt,
  COMFORTABLE_ALT_TEXT_LENGTH,
  findUnsupportedProperNouns,
  IMAGE_ALT_TEXT_SYSTEM_PROMPT,
  looksLikeKeywordStuffing,
  stripRedundantImagePrefix,
  type ImageAltTextContext,
} from "@/features/ai-workspace/services/image-alt-text.service";

const CTX: ImageAltTextContext = {
  seoProjectId: "01a002a5-ffa5-705e-9731-806267514305",
  companyId: "00000000-0000-0000-0000-000000000001",
  seoProjectName: "Storage Moguls",
  domain: "https://www.storagemoguls.com/",
  source: {
    fileName: "storage-investing-final-v2.png",
    mimeType: "image/png",
    contentTitle: "How Self Storage Investing Works",
    contentMetaDescription: "An introduction to self storage as an asset class.",
  },
  imageDescription: "A person sitting at a desk reviewing a spreadsheet on a laptop.",
};

const VALID = {
  altText: "A person at a desk reviewing a spreadsheet on a laptop.",
  reasoning: "Described exactly what the user reported: a person, a desk, a spreadsheet and a laptop.",
  accessibilityNote: "",
};

describe("IMAGE_ALT_TEXT_SYSTEM_PROMPT — the no-vision contract", () => {
  it("1. states plainly that the model cannot see the image", () => {
    expect(IMAGE_ALT_TEXT_SYSTEM_PROMPT).toMatch(/CRITICAL — YOU CANNOT SEE THE IMAGE/);
    expect(IMAGE_ALT_TEXT_SYSTEM_PROMPT).toMatch(/No image data has been given to you/);
  });

  it("2. forbids claiming it viewed, inspected, analysed or scanned anything", () => {
    expect(IMAGE_ALT_TEXT_SYSTEM_PROMPT).toMatch(/have not viewed, inspected, analysed, scanned or read/i);
  });

  it("3. names the user's description as the only evidence", () => {
    expect(IMAGE_ALT_TEXT_SYSTEM_PROMPT).toMatch(/only evidence of what the image contains/i);
  });

  it("4. states that Content context is NOT evidence of image contents", () => {
    expect(IMAGE_ALT_TEXT_SYSTEM_PROMPT).toMatch(/does not mean the picture shows a storage unit/i);
  });

  it("5. states that Brand Profile is NOT evidence of image contents", () => {
    expect(IMAGE_ALT_TEXT_SYSTEM_PROMPT).toMatch(/a company selling storage units does not mean this image shows one/i);
  });

  it("6. states that the FILE NAME is not a description", () => {
    expect(IMAGE_ALT_TEXT_SYSTEM_PROMPT).toMatch(/storage-investing-final-v2\.png" is not proof/i);
    expect(IMAGE_ALT_TEXT_SYSTEM_PROMPT).toMatch(/Never describe the image based on its file name/i);
  });

  it("7. forbids inventing each class of visual detail", () => {
    for (const forbidden of ["person", "object", "location", "setting", "action", "product", "colour", "logo", "brand"]) {
      expect(IMAGE_ALT_TEXT_SYSTEM_PROMPT.toLowerCase()).toContain(forbidden);
    }
  });

  it("8. forbids claiming to read text inside the image (no fake OCR)", () => {
    expect(IMAGE_ALT_TEXT_SYSTEM_PROMPT).toMatch(/Never claim to have read words, signs, captions, labels or numbers inside the image/i);
    expect(IMAGE_ALT_TEXT_SYSTEM_PROMPT).toMatch(/they must supply it in their description/i);
  });

  it("9. forbids the redundant 'Image of' opening", () => {
    expect(IMAGE_ALT_TEXT_SYSTEM_PROMPT).toMatch(/Do not start with "Image of"/);
  });

  it("10. forbids keyword stuffing and forced project keywords", () => {
    expect(IMAGE_ALT_TEXT_SYSTEM_PROMPT).toMatch(/Do not stuff keywords/i);
    expect(IMAGE_ALT_TEXT_SYSTEM_PROMPT).toMatch(/never insert one because it exists in the project/i);
  });

  it("11. forbids marketing language in alt text", () => {
    expect(IMAGE_ALT_TEXT_SYSTEM_PROMPT).toMatch(/alt text describes the image, it does not advertise the company/i);
  });

  it("12. tells the model to admit vagueness rather than invent detail", () => {
    expect(IMAGE_ALT_TEXT_SYSTEM_PROMPT).toMatch(/rather than inventing detail to fill it out/i);
  });
});

describe("stripRedundantImagePrefix", () => {
  it("13. strips the redundant openings a screen reader already announces", () => {
    expect(stripRedundantImagePrefix("Image of a dog running")).toBe("A dog running");
    expect(stripRedundantImagePrefix("Photo of a dog")).toBe("A dog");
    expect(stripRedundantImagePrefix("A picture showing a dog")).toBe("A dog");
    expect(stripRedundantImagePrefix("Screenshot of a dashboard")).toBe("A dashboard");
    expect(stripRedundantImagePrefix("Illustration depicting a map")).toBe("A map");
  });

  it("14. leaves ordinary alt text untouched", () => {
    expect(stripRedundantImagePrefix("A person reviewing a spreadsheet")).toBe("A person reviewing a spreadsheet");
    expect(stripRedundantImagePrefix("Two people imaging a scan")).toBe("Two people imaging a scan");
  });

  it("15. does not strip a legitimate sentence that merely mentions an image", () => {
    expect(stripRedundantImagePrefix("Imaging equipment in a hospital room")).toBe("Imaging equipment in a hospital room");
  });
});

describe("looksLikeKeywordStuffing", () => {
  it("16. catches a content word repeated three or more times in one short sentence", () => {
    expect(looksLikeKeywordStuffing("Self storage units, storage facility, storage investing storage")).toBe(true);
  });

  it("17. leaves natural alt text alone even when it repeats function words", () => {
    expect(looksLikeKeywordStuffing("A man in a room in a house")).toBe(false);
    expect(looksLikeKeywordStuffing("A person at a desk reviewing a spreadsheet on a laptop")).toBe(false);
  });

  it("18. allows a term used twice — repetition is not automatically stuffing", () => {
    expect(looksLikeKeywordStuffing("A storage unit beside another storage unit")).toBe(false);
  });
});

describe("findUnsupportedProperNouns — invented brands, people and places", () => {
  const evidence = "A person sitting at a desk reviewing a spreadsheet on a laptop. Storage Moguls storagemoguls.com";

  it("19. flags a brand name no evidence mentions", () => {
    expect(findUnsupportedProperNouns("A person using a Dell laptop", evidence)).toEqual(["Dell"]);
  });

  it("20. flags an invented place", () => {
    expect(findUnsupportedProperNouns("A person at a desk in Chicago", evidence)).toEqual(["Chicago"]);
  });

  it("21. flags an invented person's name", () => {
    expect(findUnsupportedProperNouns("Sarah reviewing a spreadsheet", "A person reviewing a spreadsheet")).toEqual(["Sarah"]);
  });

  it("22. allows a proper noun the evidence DOES supply", () => {
    expect(findUnsupportedProperNouns("A Storage Moguls spreadsheet on a laptop", evidence)).toEqual([]);
  });

  it("23. never flags the first word for being capitalised", () => {
    expect(findUnsupportedProperNouns("Spreadsheet review at a desk", evidence)).toEqual([]);
  });

  it("24. is empty for ordinary lowercase alt text", () => {
    expect(findUnsupportedProperNouns("a person at a desk", evidence)).toEqual([]);
  });
});

describe("buildLengthGuidance — guidance, never rejection", () => {
  it("25. is empty for comfortably short alt text", () => {
    expect(buildLengthGuidance("A person at a desk")).toBe("");
  });

  it("26. advises, without rejecting, when the alt text runs long", () => {
    const guidance = buildLengthGuidance("x".repeat(COMFORTABLE_ALT_TEXT_LENGTH + 1));
    expect(guidance).toContain(String(COMFORTABLE_ALT_TEXT_LENGTH + 1) + " characters");
    expect(guidance).toMatch(/Keep the length if every part of it carries meaning/);
  });
});

describe("buildPrompt — evidence hierarchy", () => {
  it("27. puts the user's description first and labels it as the only evidence", () => {
    const prompt = buildPrompt(CTX, null);
    expect(prompt).toContain("=== USER-PROVIDED IMAGE DESCRIPTION (your only evidence of what the image shows) ===");
    expect(prompt).toContain("A person sitting at a desk reviewing a spreadsheet on a laptop.");
  });

  it("28. labels Content context as relevance only, NOT evidence of image contents", () => {
    const prompt = buildPrompt(CTX, null);
    expect(prompt).toContain("CONTENT CONTEXT (where the image appears — relevance and terminology only, NOT evidence of image contents)");
    expect(prompt).toContain("How Self Storage Investing Works");
  });

  it("29. labels the file name as a typed label, never a description", () => {
    const prompt = buildPrompt(CTX, null);
    expect(prompt).toContain("FILE METADATA (a label someone typed — never a description of the image)");
    expect(prompt).toContain("storage-investing-final-v2.png");
  });

  it("30. labels Brand Profile as tone only, and omits the section entirely when absent", () => {
    expect(buildPrompt(CTX, { brandName: "Storage Moguls" } as never)).toContain("BRAND PROFILE (tone and language only, NOT evidence of image contents)");
    expect(buildPrompt(CTX, null)).not.toContain("=== BRAND PROFILE");
  });

  it("31. states plainly when the image has no Content association", () => {
    const prompt = buildPrompt({ ...CTX, source: { ...CTX.source, contentTitle: null, contentMetaDescription: null } }, null);
    expect(prompt).toMatch(/not attached to a content record — rely on the user's description alone/);
  });

  it("32. closes by forbidding any added visual detail", () => {
    expect(buildPrompt(CTX, null)).toMatch(/Never add a person, object, place, brand, logo, colour or piece of text that is not in it/);
  });
});

describe("buildImageAltTextResult — valid output", () => {
  it("33. accepts grounded alt text and reports its character count", () => {
    const result = buildImageAltTextResult(VALID, CTX, null);
    expect(result).not.toBeNull();
    expect(result!.altText).toBe(VALID.altText);
    expect(result!.characterCount).toBe(VALID.altText.length);
    expect(result!.lengthGuidance).toBe("");
  });

  it("34. strips the redundant prefix rather than rejecting an otherwise good sentence", () => {
    const result = buildImageAltTextResult({ ...VALID, altText: "Image of a person at a desk reviewing a spreadsheet." }, CTX, null);
    expect(result!.altText).toBe("A person at a desk reviewing a spreadsheet.");
  });

  it("35. strips configuration artifacts and HTML", () => {
    const result = buildImageAltTextResult({ ...VALID, altText: "<p>A person at a desk reviewing a spreadsheet.</p>" }, CTX, null);
    expect(result!.altText).toBe("A person at a desk reviewing a spreadsheet.");
  });

  it("36. keeps a long but genuinely descriptive alt text, flagging it instead of rejecting", () => {
    const long = "A person sitting at a wooden desk reviewing a spreadsheet on a laptop, with a notebook and a mug beside the keyboard and a window behind them showing daylight outside.";
    const result = buildImageAltTextResult({ ...VALID, altText: long }, CTX, null);
    expect(result).not.toBeNull();
    expect(result!.altText).toBe(long);
    expect(result!.lengthGuidance).not.toBe("");
  });
});

describe("buildImageAltTextResult — malformed output", () => {
  it("37. rejects a non-object", () => {
    expect(buildImageAltTextResult(null, CTX, null)).toBeNull();
    expect(buildImageAltTextResult("alt text", CTX, null)).toBeNull();
  });

  it("38. rejects missing or wrongly-typed required fields", () => {
    expect(buildImageAltTextResult({ reasoning: "r" }, CTX, null)).toBeNull();
    expect(buildImageAltTextResult({ altText: "a" }, CTX, null)).toBeNull();
    expect(buildImageAltTextResult({ altText: 5, reasoning: "r" }, CTX, null)).toBeNull();
  });

  it("39. rejects EMPTY alt text — a meaningful image must not get an empty alt", () => {
    expect(buildImageAltTextResult({ ...VALID, altText: "" }, CTX, null)).toBeNull();
    expect(buildImageAltTextResult({ ...VALID, altText: "   " }, CTX, null)).toBeNull();
  });

  it("40. rejects alt text that is only a redundant prefix", () => {
    expect(buildImageAltTextResult({ ...VALID, altText: "Image of " }, CTX, null)).toBeNull();
  });

  it("41. rejects a blank reasoning — the reviewer note is required", () => {
    expect(buildImageAltTextResult({ ...VALID, reasoning: "  " }, CTX, null)).toBeNull();
  });

  it("42. tolerates a missing accessibilityNote by treating it as empty", () => {
    const result = buildImageAltTextResult({ altText: VALID.altText, reasoning: VALID.reasoning }, CTX, null);
    expect(result).not.toBeNull();
    expect(result!.accessibilityNote).toBe("");
  });
});

describe("buildImageAltTextResult — invention is rejected", () => {
  it("43. rejects an invented BRAND or logo", () => {
    expect(buildImageAltTextResult({ ...VALID, altText: "A person using a MacBook at a desk." }, CTX, null)).toBeNull();
  });

  it("44. rejects an invented LOCATION", () => {
    expect(buildImageAltTextResult({ ...VALID, altText: "A person at a desk in Denver reviewing a spreadsheet." }, CTX, null)).toBeNull();
  });

  it("45. rejects an invented PERSON", () => {
    expect(buildImageAltTextResult({ ...VALID, altText: "A person named Sarah reviewing a spreadsheet." }, CTX, null)).toBeNull();
  });

  it("46. allows a proper noun the Brand Profile genuinely supplies", () => {
    const result = buildImageAltTextResult(
      { ...VALID, altText: "A person reviewing a Storage Moguls spreadsheet on a laptop." },
      CTX,
      { brandName: "Storage Moguls" } as never
    );
    expect(result).not.toBeNull();
  });

  it("47. rejects a fabricated metric", () => {
    expect(buildImageAltTextResult({ ...VALID, altText: "A spreadsheet showing a 45% increase in occupancy." }, CTX, null)).toBeNull();
    expect(buildImageAltTextResult({ ...VALID, altText: "A chart of 12,000 monthly searches." }, CTX, null)).toBeNull();
  });

  it("48. rejects unsupported marketing claims", () => {
    for (const claim of [
      "The award-winning storage facility team at a desk.",
      "Our best-selling spreadsheet template on a laptop.",
      "The #1 platform for storage investors.",
      "A desk scene with guaranteed results.",
    ]) {
      expect(buildImageAltTextResult({ ...VALID, altText: claim }, CTX, null)).toBeNull();
    }
  });

  it("49. rejects keyword-stuffed alt text", () => {
    expect(
      buildImageAltTextResult({ ...VALID, altText: "Storage investing desk, storage investing laptop, storage investing spreadsheet." }, CTX, null)
    ).toBeNull();
  });

  it("50. rejects instruction echo in the alt text or the accessibility note", () => {
    expect(buildImageAltTextResult({ ...VALID, altText: "EXACTLY 50-60 characters" }, CTX, null)).toBeNull();
    expect(buildImageAltTextResult({ ...VALID, accessibilityNote: "meta description: a short summary" }, CTX, null)).toBeNull();
  });

  it("51. the result shape carries no id, url, storage key or provider metadata", () => {
    const result = buildImageAltTextResult({ ...VALID, fileId: "abc", url: "uploads/x.png", provider: "gemini" }, CTX, null)!;
    expect(Object.keys(result).sort()).toEqual(["accessibilityNote", "altText", "characterCount", "lengthGuidance", "reasoning"]);
    expect(JSON.stringify(result)).not.toMatch(/uploads\/|gemini|fileId/);
  });
});
