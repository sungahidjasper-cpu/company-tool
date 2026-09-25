import { describe, expect, it } from "vitest";

import {
  buildEmailNewsletterResult,
  buildPrompt,
  containsUnsupportedMarketingClaim,
  EMAIL_NEWSLETTER_SYSTEM_PROMPT,
  type EmailNewsletterContext,
} from "@/features/ai-workspace/services/email-newsletter.service";

const CTX: EmailNewsletterContext = {
  seoProjectId: "01a002a5-ffa5-705e-9731-806267514305",
  companyId: "00000000-0000-0000-0000-000000000001",
  seoProjectName: "Storage Moguls",
  domain: "https://www.storagemoguls.com/",
  sourceContent: {
    title: "How Self Storage Investing Works",
    url: "https://www.storagemoguls.com/self-storage-investing",
    metaDescription: "An introduction to self storage as an asset class.",
    body: "Self storage facilities generate income from monthly unit rentals. Occupancy and unit mix drive returns.",
  },
};

const VALID = {
  subjectLine: "A practical look at self storage investing",
  previewText: "How occupancy and unit mix shape returns.",
  headline: "Self storage investing, explained",
  introduction: "Here is a short walkthrough of how self storage facilities actually make money.",
  bodySections: [
    { heading: "Where the income comes from", body: "Facilities earn from monthly unit rentals." },
    { heading: "What drives returns", body: "Occupancy and unit mix are the main levers." },
  ],
  callToAction: "Read the full guide on our site",
  closing: "Thanks for reading.",
  reasoning: "Summarised the source page into two sections and closed with the supplied call to action.",
};

describe("EMAIL_NEWSLETTER_SYSTEM_PROMPT — the four material categories", () => {
  it("1. names all four kinds of material and how much authority each carries", () => {
    for (const marker of ["SOURCE CONTENT", "USER INPUT", "BRAND PROFILE", "YOUR OWN WRITING"]) {
      expect(EMAIL_NEWSLETTER_SYSTEM_PROMPT).toContain(marker);
    }
  });

  it("2. forbids inventing the specific fact classes that must never appear", () => {
    for (const forbidden of ["statistic", "testimonial", "guarantee", "price", "discount", "award", "certification", "case study", "customer result"]) {
      expect(EMAIL_NEWSLETTER_SYSTEM_PROMPT.toLowerCase()).toContain(forbidden);
    }
  });

  it("3. forbids the named unsupported marketing claims", () => {
    for (const claim of ["best-selling", "thousands of customers", "guaranteed results", "industry-leading"]) {
      expect(EMAIL_NEWSLETTER_SYSTEM_PROMPT.toLowerCase()).toContain(claim);
    }
  });

  it("4. forbids claiming the newsletter improves rankings or AI visibility", () => {
    expect(EMAIL_NEWSLETTER_SYSTEM_PROMPT).toMatch(/never claim the newsletter will improve rankings/i);
  });

  it("5. forbids implying the email was sent, scheduled or delivered", () => {
    expect(EMAIL_NEWSLETTER_SYSTEM_PROMPT).toMatch(/never write anything that implies the email has been sent, scheduled, or delivered/i);
  });

  it("6. forbids forcing keywords in unnaturally", () => {
    expect(EMAIL_NEWSLETTER_SYSTEM_PROMPT).toMatch(/never force keywords in/i);
  });
});

describe("containsUnsupportedMarketingClaim", () => {
  it("7. catches superlatives with no evidence behind them", () => {
    for (const claim of ["our best-selling product", "an industry-leading platform", "award-winning service", "the #1 choice for investors", "world-class support"]) {
      expect(containsUnsupportedMarketingClaim(claim)).toBe(true);
    }
  });

  it("8. catches unevidenced scale claims", () => {
    for (const claim of ["thousands of customers trust us", "trusted by thousands", "join thousands of investors", "millions of users"]) {
      expect(containsUnsupportedMarketingClaim(claim)).toBe(true);
    }
  });

  it("9. catches guarantees", () => {
    for (const claim of ["guaranteed results", "we guarantee returns", "risk-free trial", "money-back guarantee"]) {
      expect(containsUnsupportedMarketingClaim(claim)).toBe(true);
    }
  });

  it("10. catches fabricated performance percentages", () => {
    for (const claim of ["increased conversions by 200%", "boost your returns by 30%", "a 45% increase in occupancy", "proven results"]) {
      expect(containsUnsupportedMarketingClaim(claim)).toBe(true);
    }
  });

  it("11. leaves ordinary, honest email copy alone", () => {
    for (const ok of [
      "Read the full guide on our site",
      "Here is how self storage facilities generate income.",
      "Occupancy and unit mix are the main levers on returns.",
      "We published a new guide this month.",
      "Thanks for reading.",
    ]) {
      expect(containsUnsupportedMarketingClaim(ok)).toBe(false);
    }
  });

  it("12. is safe on empty input", () => {
    expect(containsUnsupportedMarketingClaim("")).toBe(false);
  });
});

describe("buildPrompt — grounding separation", () => {
  it("13. labels the source content section and passes the real page text", () => {
    const prompt = buildPrompt(CTX, null);
    expect(prompt).toContain("=== SOURCE CONTENT");
    expect(prompt).toContain("How Self Storage Investing Works");
    expect(prompt).toContain("Self storage facilities generate income from monthly unit rentals.");
  });

  it("14. keeps user input in its own labelled section", () => {
    const prompt = buildPrompt({ ...CTX, audience: "First-time investors", campaignAngle: "Monthly roundup" }, null);
    expect(prompt).toContain("=== USER INPUT");
    expect(prompt).toContain("Audience: First-time investors");
    expect(prompt).toContain("Campaign angle / newsletter purpose: Monthly roundup");
  });

  it("15. states explicitly when the user supplied no CTA, and forbids inventing an offer", () => {
    const prompt = buildPrompt(CTX, null);
    expect(prompt).toMatch(/Call to action: \(none supplied/);
    expect(prompt).toMatch(/do not invent an offer, discount, deadline or event/);
  });

  it("16. uses the user's own CTA wording when they supplied one", () => {
    const prompt = buildPrompt({ ...CTX, callToAction: "Book a call with our team" }, null);
    expect(prompt).toContain("Call to action to use (their wording and intent): Book a call with our team");
  });

  it("17. states explicitly when no audience was supplied rather than inventing a segment", () => {
    expect(buildPrompt(CTX, null)).toMatch(/Audience: \(not specified.*do not invent a segment/);
  });

  it("18. keeps Brand Profile in its own section, marked as tone not fact", () => {
    const prompt = buildPrompt(CTX, { brandName: "Storage Moguls", brandVoice: "Direct", targetAudience: "Investors" } as never);
    expect(prompt).toContain("=== BRAND PROFILE (tone and company description only — not a source of new facts) ===");
    expect(prompt).toContain("Brand name: Storage Moguls.");
  });

  it("19. omits the Brand Profile section entirely when there is no profile", () => {
    expect(buildPrompt(CTX, null)).not.toContain("=== BRAND PROFILE");
  });

  it("20. tells the model not to invent article content when the source has no body", () => {
    const prompt = buildPrompt({ ...CTX, sourceContent: { ...CTX.sourceContent, body: null }, additionalContext: "We launched a new calculator." }, null);
    expect(prompt).toMatch(/this content record has no body text/i);
    expect(prompt).toMatch(/do not invent article content/i);
    expect(prompt).toContain("We launched a new calculator.");
  });

  it("21. marks a truncated body as truncated rather than letting it read as the whole article", () => {
    const prompt = buildPrompt({ ...CTX, sourceContent: { ...CTX.sourceContent, body: "x".repeat(20000) } }, null);
    expect(prompt).toContain("[…the article continues beyond this excerpt…]");
    expect(prompt.length).toBeLessThan(20000);
  });

  it("22. closes by forbidding any new fact", () => {
    expect(buildPrompt(CTX, null)).toMatch(/Never introduce a fact, figure, testimonial, claim, price, date or guarantee that is not already there/);
  });
});

describe("buildEmailNewsletterResult — valid output", () => {
  it("23. accepts a well-formed, grounded newsletter unchanged", () => {
    const result = buildEmailNewsletterResult(VALID, { ...CTX, callToAction: "Read the full guide on our site" });
    expect(result).not.toBeNull();
    expect(result!.subjectLine).toBe(VALID.subjectLine);
    expect(result!.bodySections).toHaveLength(2);
    expect(result!.callToAction).toBe("Read the full guide on our site");
  });

  it("24. strips configuration artifacts and HTML from every field", () => {
    const result = buildEmailNewsletterResult(
      {
        ...VALID,
        subjectLine: "A practical look at self storage investing | 1500 words",
        headline: "<h1>Self storage investing, explained</h1>",
        bodySections: [{ heading: "1.1 Where the income comes from", body: "<p>Facilities earn from monthly unit rentals.</p>" }],
      },
      CTX
    );
    expect(result).not.toBeNull();
    expect(result!.subjectLine).not.toMatch(/1500 words/);
    expect(result!.headline).toBe("Self storage investing, explained");
    expect(result!.bodySections[0].heading).toBe("Where the income comes from");
    expect(result!.bodySections[0].body).toBe("Facilities earn from monthly unit rentals.");
  });
});

describe("buildEmailNewsletterResult — malformed output is rejected, never repaired", () => {
  it("25. rejects a non-object", () => {
    expect(buildEmailNewsletterResult(null, CTX)).toBeNull();
    expect(buildEmailNewsletterResult("a newsletter", CTX)).toBeNull();
    expect(buildEmailNewsletterResult(42, CTX)).toBeNull();
  });

  it("26. rejects output missing any required field", () => {
    for (const field of ["subjectLine", "previewText", "headline", "introduction", "bodySections", "callToAction", "closing", "reasoning"]) {
      const broken: Record<string, unknown> = { ...VALID };
      delete broken[field];
      expect(buildEmailNewsletterResult(broken, CTX)).toBeNull();
    }
  });

  it("27. rejects a required field of the wrong type", () => {
    expect(buildEmailNewsletterResult({ ...VALID, subjectLine: 12 }, CTX)).toBeNull();
    expect(buildEmailNewsletterResult({ ...VALID, bodySections: "two sections" }, CTX)).toBeNull();
  });

  it("28. rejects an empty subject, preview, headline or introduction", () => {
    for (const field of ["subjectLine", "previewText", "headline", "introduction"]) {
      expect(buildEmailNewsletterResult({ ...VALID, [field]: "   " }, CTX)).toBeNull();
    }
  });

  it("29. rejects a blank reasoning — the reviewer note is required", () => {
    expect(buildEmailNewsletterResult({ ...VALID, reasoning: "   " }, CTX)).toBeNull();
  });

  it("30. rejects a newsletter whose sections are all unusable — no body is not a newsletter", () => {
    expect(buildEmailNewsletterResult({ ...VALID, bodySections: [] }, CTX)).toBeNull();
    expect(buildEmailNewsletterResult({ ...VALID, bodySections: [{ heading: "", body: "" }] }, CTX)).toBeNull();
    expect(buildEmailNewsletterResult({ ...VALID, bodySections: [{ heading: "H", body: 5 }] }, CTX)).toBeNull();
  });

  it("31. skips a malformed section but keeps the well-formed ones", () => {
    const result = buildEmailNewsletterResult(
      { ...VALID, bodySections: [null, { heading: "Good", body: "Real text." }, { heading: "Missing body" }] },
      CTX
    );
    expect(result).not.toBeNull();
    expect(result!.bodySections).toEqual([{ heading: "Good", body: "Real text." }]);
  });
});

describe("buildEmailNewsletterResult — fabricated facts and metrics", () => {
  it("32. rejects the whole draft when a load-bearing field fabricates a metric", () => {
    for (const field of ["subjectLine", "previewText", "headline", "introduction"]) {
      expect(buildEmailNewsletterResult({ ...VALID, [field]: "We rank #1 for self storage investing" }, CTX)).toBeNull();
    }
  });

  it("33. rejects the whole draft when a load-bearing field makes an unsupported marketing claim", () => {
    expect(buildEmailNewsletterResult({ ...VALID, subjectLine: "Our best-selling guide is here" }, CTX)).toBeNull();
    expect(buildEmailNewsletterResult({ ...VALID, introduction: "Trusted by thousands of investors." }, CTX)).toBeNull();
  });

  it("34. drops only the offending SECTION — one bad section is not fatal", () => {
    const result = buildEmailNewsletterResult(
      {
        ...VALID,
        bodySections: [
          { heading: "Where the income comes from", body: "Facilities earn from monthly unit rentals." },
          { heading: "Our results", body: "We increased occupancy by 45% for thousands of customers." },
        ],
      },
      CTX
    );
    expect(result).not.toBeNull();
    expect(result!.bodySections).toHaveLength(1);
    expect(result!.bodySections[0].heading).toBe("Where the income comes from");
  });

  it("35. rejects the draft when EVERY section is ungrounded", () => {
    expect(
      buildEmailNewsletterResult(
        { ...VALID, bodySections: [{ heading: "Results", body: "Guaranteed results for thousands of customers." }] },
        CTX
      )
    ).toBeNull();
  });

  it("36. rejects a closing that fabricates a claim", () => {
    expect(buildEmailNewsletterResult({ ...VALID, closing: "Join thousands of happy subscribers." }, CTX)).toBeNull();
  });

  it("37. rejects instruction echo in a load-bearing field", () => {
    // The phrasings looksLikeInstructionEcho actually detects — it is a
    // deliberately narrow, high-confidence filter, not a fuzzy keyword scan.
    expect(buildEmailNewsletterResult({ ...VALID, introduction: "EXACTLY 50-60 characters for the subject line" }, CTX)).toBeNull();
    expect(buildEmailNewsletterResult({ ...VALID, previewText: "meta description: a short summary" }, CTX)).toBeNull();
  });
});

describe("buildEmailNewsletterResult — the call-to-action asymmetry", () => {
  it("38. keeps a user-supplied CTA verbatim even though it contains their own strong claim", () => {
    const result = buildEmailNewsletterResult(
      { ...VALID, callToAction: "Claim your guaranteed spot on the waitlist" },
      { ...CTX, callToAction: "Claim your guaranteed spot on the waitlist" }
    );
    expect(result).not.toBeNull();
    expect(result!.callToAction).toBe("Claim your guaranteed spot on the waitlist");
  });

  it("39. clears an INVENTED CTA claim when the user supplied none — fabrication by definition", () => {
    const result = buildEmailNewsletterResult({ ...VALID, callToAction: "Get guaranteed results today" }, CTX);
    expect(result).not.toBeNull();
    expect(result!.callToAction).toBe("");
  });

  it("40. keeps an ordinary invented CTA that makes no claim", () => {
    const result = buildEmailNewsletterResult({ ...VALID, callToAction: "Read the full guide on our site" }, CTX);
    expect(result!.callToAction).toBe("Read the full guide on our site");
  });

  it("41. rejects the whole draft when the CTA echoes instructions — even a user-supplied one", () => {
    expect(buildEmailNewsletterResult({ ...VALID, callToAction: "EXACTLY 20 words total" }, CTX)).toBeNull();
    expect(
      buildEmailNewsletterResult({ ...VALID, callToAction: "EXACTLY 20 words total" }, { ...CTX, callToAction: "Book a call" })
    ).toBeNull();
  });

  it("42. an empty CTA is allowed — it is optional, not required", () => {
    const result = buildEmailNewsletterResult({ ...VALID, callToAction: "" }, CTX);
    expect(result).not.toBeNull();
    expect(result!.callToAction).toBe("");
  });
});

describe("buildEmailNewsletterResult — no delivery semantics anywhere", () => {
  it("43. the result shape carries no send, schedule, recipient or campaign field", () => {
    const result = buildEmailNewsletterResult(VALID, CTX)!;
    expect(Object.keys(result).sort()).toEqual([
      "bodySections",
      "callToAction",
      "closing",
      "headline",
      "introduction",
      "previewText",
      "reasoning",
      "subjectLine",
    ]);
  });

  it("44. ignores extra provider fields rather than carrying them through", () => {
    const result = buildEmailNewsletterResult({ ...VALID, sentAt: "2026-09-05", recipients: 4200, campaignId: "abc" }, CTX)!;
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/sentAt|recipients|campaignId/);
  });
});
