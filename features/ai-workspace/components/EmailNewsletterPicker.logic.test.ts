import { describe, expect, it } from "vitest";

import { buildNewsletterRequest, computeCanDraft, NEWSLETTER_NULL_RESULT_MESSAGE, type ContentOption } from "@/features/ai-workspace/components/EmailNewsletterPicker";
import { formatNewsletterAsText } from "@/features/ai-workspace/components/EmailNewsletterReview";
import { hasEnoughSourceMaterial, INSUFFICIENT_SOURCE_MATERIAL_MESSAGE, type EmailNewsletterResult } from "@/features/ai-workspace/schemas/email-newsletter.schema";

/**
 * This repository has no React rendering test setup (vitest runs
 * `environment: "node"`), so the picker's real logic is tested as pure
 * functions — the same approach every other AI Workspace picker uses.
 */

const PROJECT_ID = "01a002a5-ffa5-705e-9731-806267514305";
const CONTENT_ID = "01a002a5-ffa5-705e-9731-8062675143ae";

const WITH_BODY: ContentOption = { id: CONTENT_ID, title: "How Self Storage Investing Works", hasBody: true };
const WITHOUT_BODY: ContentOption = { id: CONTENT_ID, title: "Brief-only record", hasBody: false };

const RESULT: EmailNewsletterResult = {
  subjectLine: "A practical look at self storage investing",
  previewText: "How occupancy and unit mix shape returns.",
  headline: "Self storage investing, explained",
  introduction: "Here is a short walkthrough of how these facilities make money.",
  bodySections: [
    { heading: "Where the income comes from", body: "Facilities earn from monthly unit rentals." },
    { heading: "What drives returns", body: "Occupancy and unit mix are the main levers." },
  ],
  callToAction: "Read the full guide on our site",
  closing: "Thanks for reading.",
  reasoning: "Summarised the source page into two sections.",
};

describe("hasEnoughSourceMaterial — the shared source rule", () => {
  it("1. body text alone is enough", () => {
    expect(hasEnoughSourceMaterial({ body: "Real article text." })).toBe(true);
  });

  it("2. user context alone is enough", () => {
    expect(hasEnoughSourceMaterial({ body: null, additionalContext: "We launched a calculator." })).toBe(true);
  });

  it("3. neither is not enough — a title alone can only be padded out with invention", () => {
    expect(hasEnoughSourceMaterial({ body: null })).toBe(false);
    expect(hasEnoughSourceMaterial({ body: "", additionalContext: "" })).toBe(false);
    expect(hasEnoughSourceMaterial({ body: "  \n ", additionalContext: "   " })).toBe(false);
  });
});

describe("computeCanDraft — the Generate gate", () => {
  it("4. enabled with a project, a content record and body text", () => {
    expect(computeCanDraft(PROJECT_ID, CONTENT_ID, WITH_BODY, "")).toBe(true);
  });

  it("5. blocked with no project selected — the tool never defaults to one", () => {
    expect(computeCanDraft("", CONTENT_ID, WITH_BODY, "")).toBe(false);
    expect(computeCanDraft("   ", CONTENT_ID, WITH_BODY, "")).toBe(false);
  });

  it("6. blocked with no source content selected", () => {
    expect(computeCanDraft(PROJECT_ID, "", WITH_BODY, "")).toBe(false);
  });

  it("7. blocked when the selected content is not in the current project's list", () => {
    expect(computeCanDraft(PROJECT_ID, CONTENT_ID, undefined, "")).toBe(false);
  });

  it("8. blocked for a body-less record with no additional context", () => {
    expect(computeCanDraft(PROJECT_ID, CONTENT_ID, WITHOUT_BODY, "")).toBe(false);
  });

  it("9. unblocked once the user supplies their own context for a body-less record", () => {
    expect(computeCanDraft(PROJECT_ID, CONTENT_ID, WITHOUT_BODY, "We launched a new calculator.")).toBe(true);
  });

  it("10. whitespace-only context does not unblock it", () => {
    expect(computeCanDraft(PROJECT_ID, CONTENT_ID, WITHOUT_BODY, "   ")).toBe(false);
  });
});

describe("buildNewsletterRequest", () => {
  it("11. sends blank optional fields as undefined, never as empty strings", () => {
    const request = buildNewsletterRequest(PROJECT_ID, CONTENT_ID, { audience: "", callToAction: "", campaignAngle: "", additionalContext: "", notes: "" });
    expect(request).toEqual({
      seoProjectId: PROJECT_ID,
      contentId: CONTENT_ID,
      audience: undefined,
      callToAction: undefined,
      campaignAngle: undefined,
      additionalContext: undefined,
      notes: undefined,
    });
  });

  it("12. trims the values the user did supply", () => {
    const request = buildNewsletterRequest(PROJECT_ID, CONTENT_ID, {
      audience: "  Investors  ",
      callToAction: "  Read the guide  ",
      campaignAngle: "  Monthly roundup  ",
      additionalContext: "  Extra facts  ",
      notes: "  Keep it short  ",
    });
    expect(request.audience).toBe("Investors");
    expect(request.callToAction).toBe("Read the guide");
    expect(request.campaignAngle).toBe("Monthly roundup");
    expect(request.additionalContext).toBe("Extra facts");
    expect(request.notes).toBe("Keep it short");
  });

  it("13. carries ids only — no company, ownership or body field", () => {
    const request = buildNewsletterRequest(PROJECT_ID, CONTENT_ID, { audience: "", callToAction: "", campaignAngle: "", additionalContext: "", notes: "" });
    expect(JSON.stringify(request)).not.toMatch(/companyId|userId|role|body/i);
  });
});

describe("formatNewsletterAsText — the Copy output", () => {
  it("14. labels subject and preview text as inbox metadata rather than body copy", () => {
    const text = formatNewsletterAsText(RESULT);
    expect(text).toContain("Subject: A practical look at self storage investing");
    expect(text).toContain("Preview text: How occupancy and unit mix shape returns.");
  });

  it("15. includes the headline, introduction, every section, the CTA and the closing", () => {
    const text = formatNewsletterAsText(RESULT);
    for (const expected of [
      "Self storage investing, explained",
      "Here is a short walkthrough",
      "Where the income comes from",
      "Facilities earn from monthly unit rentals.",
      "What drives returns",
      "Read the full guide on our site",
      "Thanks for reading.",
    ]) {
      expect(text).toContain(expected);
    }
  });

  it("16. keeps the newsletter in reading order", () => {
    const text = formatNewsletterAsText(RESULT);
    expect(text.indexOf("Subject:")).toBeLessThan(text.indexOf("Self storage investing, explained"));
    expect(text.indexOf("Where the income comes from")).toBeLessThan(text.indexOf("What drives returns"));
    expect(text.indexOf("What drives returns")).toBeLessThan(text.indexOf("Read the full guide"));
  });

  it("17. never includes the reviewer-only reasoning note in the copied email", () => {
    expect(formatNewsletterAsText(RESULT)).not.toContain("Summarised the source page");
  });

  it("18. omits an empty CTA or closing rather than leaving blank gaps", () => {
    const text = formatNewsletterAsText({ ...RESULT, callToAction: "", closing: "" });
    expect(text).not.toContain("Read the full guide");
    expect(text.endsWith("Occupancy and unit mix are the main levers.")).toBe(true);
  });

  it("19. never leaks internal ids or provider names", () => {
    const text = formatNewsletterAsText(RESULT);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(text).not.toMatch(/jobId|companyId|seoProjectId|contentId/i);
    expect(text).not.toMatch(/gemini|openrouter|ollama/i);
  });

  it("20. contains no delivery language — this is a draft, never a send", () => {
    expect(formatNewsletterAsText(RESULT)).not.toMatch(/\bsent\b|\bscheduled\b|\bdelivered\b|\brecipients\b|\bunsubscribe\b/i);
  });
});

describe("user-facing messages", () => {
  it("21. the null-result message blames neither the user nor their source content", () => {
    expect(NEWSLETTER_NULL_RESULT_MESSAGE).toMatch(/AI response didn't meet our quality requirements/);
    expect(NEWSLETTER_NULL_RESULT_MESSAGE).not.toMatch(/your content|not enough|insufficient/i);
  });

  it("22. the two messages are distinct — a missing source is not a provider failure", () => {
    expect(NEWSLETTER_NULL_RESULT_MESSAGE).not.toBe(INSUFFICIENT_SOURCE_MATERIAL_MESSAGE);
  });
});
