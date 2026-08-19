import { describe, expect, it } from "vitest";

import { filterReservedSections, looksLikeInstructionEcho, stripConfigurationArtifacts, stripHtmlTags } from "@/features/ai-workspace/services/content-sanitizer";

describe("stripConfigurationArtifacts", () => {
  it("strips a trailing pipe-separated word-count suffix", () => {
    expect(stripConfigurationArtifacts("Self-Storage Investing Guide | 1500 words")).toBe("Self-Storage Investing Guide");
  });

  it("strips a trailing parenthesized word-count suffix", () => {
    expect(stripConfigurationArtifacts("Self-Storage Investing Guide (1500 words)")).toBe("Self-Storage Investing Guide");
  });

  it("strips a trailing dash-separated word-count suffix", () => {
    expect(stripConfigurationArtifacts("Self-Storage Investing Guide - 1500 words")).toBe("Self-Storage Investing Guide");
    expect(stripConfigurationArtifacts("Self-Storage Investing Guide — 1,500 words")).toBe("Self-Storage Investing Guide");
  });

  it("strips a multi-level outline-numbering prefix", () => {
    expect(stripConfigurationArtifacts("1.1. Understanding Cap Rates")).toBe("Understanding Cap Rates");
    expect(stripConfigurationArtifacts("2.3 Operational Considerations")).toBe("Operational Considerations");
  });

  it("strips a single top-level outline-numbering prefix", () => {
    expect(stripConfigurationArtifacts("1. Introduction")).toBe("Introduction");
    expect(stripConfigurationArtifacts("3) Case Studies")).toBe("Case Studies");
  });

  it("leaves an ordinary heading that happens to start with a number untouched", () => {
    expect(stripConfigurationArtifacts("10 Ways to Improve Local SEO")).toBe("10 Ways to Improve Local SEO");
    expect(stripConfigurationArtifacts("5 Tips for Better SEO")).toBe("5 Tips for Better SEO");
  });

  it("leaves ordinary numbered-list content inside body text untouched (only anchored at the very start/end)", () => {
    const body = "Follow these steps: 1. Gather documents. 2. Submit the form. 3. Wait for approval.";
    expect(stripConfigurationArtifacts(body)).toBe(body);
  });

  it("leaves text with no artifacts completely unchanged", () => {
    expect(stripConfigurationArtifacts("Emergency Plumber in Austin | Acme")).toBe("Emergency Plumber in Austin | Acme");
    expect(stripConfigurationArtifacts("What are the benefits of self-storage investing?")).toBe("What are the benefits of self-storage investing?");
  });

  it("strips both a leading numbering artifact and a trailing word-count artifact on the same string", () => {
    expect(stripConfigurationArtifacts("1. Self-Storage Investing Guide | 1500 words")).toBe("Self-Storage Investing Guide");
  });
});

describe("filterReservedSections", () => {
  it("drops sections whose heading is Conclusion, FAQ, Key Takeaways, or Resources (case- and punctuation-insensitive)", () => {
    const sections = [
      { heading: "Understanding the Basics", body: "..." },
      { heading: "Conclusion", body: "..." },
      { heading: "faq", body: "..." },
      { heading: "FAQs", body: "..." },
      { heading: "Frequently Asked Questions", body: "..." },
      { heading: "Key Takeaways", body: "..." },
      { heading: "Resources:", body: "..." },
      { heading: "Getting Started", body: "..." },
    ];
    expect(filterReservedSections(sections)).toEqual([
      { heading: "Understanding the Basics", body: "..." },
      { heading: "Getting Started", body: "..." },
    ]);
  });

  it("never drops a real content section that merely contains a reserved word", () => {
    const sections = [
      { heading: "Financial Resources You'll Need", body: "..." },
      { heading: "Key Takeaways for New Investors", body: "..." },
    ];
    expect(filterReservedSections(sections)).toEqual(sections);
  });

  it("returns an empty array unchanged", () => {
    expect(filterReservedSections([])).toEqual([]);
  });
});

describe("stripHtmlTags", () => {
  it("strips tags wrapping a whole title, leaving the underlying text (the observed live defect)", () => {
    expect(stripHtmlTags("<b>Self-Storage Occupancy Rates and Unit Pricing: A Closer Look</b>")).toBe("Self-Storage Occupancy Rates and Unit Pricing: A Closer Look");
  });

  it("strips a tag in the middle of text and collapses the resulting whitespace", () => {
    expect(stripHtmlTags("Title <br> is great")).toBe("Title is great");
  });

  it("strips tags with attributes", () => {
    expect(stripHtmlTags('<span class="x">Emergency Plumber</span>')).toBe("Emergency Plumber");
  });

  it("never touches a bare comparison operator in ordinary prose", () => {
    expect(stripHtmlTags("Revenue grew 5 < 10 percent this year")).toBe("Revenue grew 5 < 10 percent this year");
  });

  it("leaves text with no markup completely unchanged", () => {
    expect(stripHtmlTags("Emergency Plumber in Austin | Acme")).toBe("Emergency Plumber in Austin | Acme");
  });
});

describe("looksLikeInstructionEcho", () => {
  it("detects the exact observed live defect", () => {
    expect(looksLikeInstructionEcho("EXACTLY 50-60 characters (50 words, 60 characters total), meta description:")).toBe(true);
  });

  it("detects a literal 'meta title:'/'meta description:' self-reference", () => {
    expect(looksLikeInstructionEcho("meta description: a guide to self-storage investing")).toBe(true);
    expect(looksLikeInstructionEcho("Meta Title: Self-Storage Investing Guide")).toBe(true);
  });

  it("detects an 'EXACTLY N-M characters/words' echo on its own", () => {
    expect(looksLikeInstructionEcho("EXACTLY 150-160 characters for this description")).toBe(true);
    expect(looksLikeInstructionEcho("Please write EXACTLY 1500 words on this topic")).toBe(true);
  });

  it("detects a 'characters total' echo on its own", () => {
    expect(looksLikeInstructionEcho("60 characters total is the limit")).toBe(true);
  });

  it("never flags an ordinary, legitimate title or description", () => {
    expect(looksLikeInstructionEcho("Self-Storage Investing for Accredited Investors")).toBe(false);
    expect(looksLikeInstructionEcho("Discover the key factors to consider when evaluating self-storage as an asset class.")).toBe(false);
    expect(looksLikeInstructionEcho("Emergency Plumber Austin | Acme")).toBe(false);
  });
});
