import { describe, expect, it } from "vitest";

import { isSafeHref, parseMarkdownBlocks } from "@/features/ai-workspace/services/markdown-preview.service";

describe("parseMarkdownBlocks", () => {
  it("parses a heading line into a heading block, by level", () => {
    expect(parseMarkdownBlocks("## Section Title")).toEqual([{ type: "heading", level: 2, text: "Section Title" }]);
    expect(parseMarkdownBlocks("#### Sub-sub-header")).toEqual([{ type: "heading", level: 4, text: "Sub-sub-header" }]);
  });

  it("splits a heading from its following paragraph even with no blank line between them (the observed real generation shape)", () => {
    const blocks = parseMarkdownBlocks("### 1. Traditional Self Storage Facilities\nThese facilities typically offer a range of unit sizes.");
    expect(blocks).toEqual([
      { type: "heading", level: 3, text: "1. Traditional Self Storage Facilities" },
      { type: "paragraph", lines: ["These facilities typically offer a range of unit sizes."] },
    ]);
  });

  it("groups blank-line-separated paragraphs into separate paragraph blocks", () => {
    const blocks = parseMarkdownBlocks("First paragraph.\n\nSecond paragraph.");
    expect(blocks).toEqual([
      { type: "paragraph", lines: ["First paragraph."] },
      { type: "paragraph", lines: ["Second paragraph."] },
    ]);
  });

  it("keeps consecutive non-blank lines as one multi-line paragraph block", () => {
    const blocks = parseMarkdownBlocks("Line one.\nLine two.");
    expect(blocks).toEqual([{ type: "paragraph", lines: ["Line one.", "Line two."] }]);
  });

  it("parses a bulleted list into a ul block", () => {
    const blocks = parseMarkdownBlocks("- First\n- Second\n- Third");
    expect(blocks).toEqual([{ type: "ul", items: ["First", "Second", "Third"] }]);
  });

  it("parses a numbered list into an ol block", () => {
    const blocks = parseMarkdownBlocks("1. Step one\n2. Step two");
    expect(blocks).toEqual([{ type: "ol", items: ["Step one", "Step two"] }]);
  });

  it("parses a genuine Markdown table into a table block, using the separator row only for detection", () => {
    const markdown = "| Metric | What It Means |\n| --- | --- |\n| LCP | How fast the page loads |\n| CLS | How stable the layout is |";
    expect(parseMarkdownBlocks(markdown)).toEqual([
      {
        type: "table",
        headers: ["Metric", "What It Means"],
        rows: [
          ["LCP", "How fast the page loads"],
          ["CLS", "How stable the layout is"],
        ],
      },
    ]);
  });

  it("never fabricates a table for ordinary prose that happens to contain a pipe character", () => {
    const blocks = parseMarkdownBlocks("Revenue was $10 | $20 depending on the market.");
    expect(blocks).toEqual([{ type: "paragraph", lines: ["Revenue was $10 | $20 depending on the market."] }]);
  });

  it("renders a full realistic article shape end-to-end: intro, H2, H3-under-H2-with-no-blank-line, list, conclusion, FAQ", () => {
    const markdown = [
      "Intro paragraph.",
      "",
      "## Types of Self Storage Investments",
      "",
      "There are several categories.",
      "",
      "### Direct Ownership",
      "Purchasing a facility outright offers the potential for returns.",
      "",
      "- Requires active management",
      "- Higher potential returns",
      "",
      "## Conclusion",
      "",
      "In summary, self-storage offers stable returns.",
      "",
      "## FAQ",
      "",
      "**What is self-storage investing?**",
      "",
      "It involves purchasing storage facilities.",
    ].join("\n");

    const blocks = parseMarkdownBlocks(markdown);
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "heading", "paragraph", "heading", "paragraph", "ul", "heading", "paragraph", "heading", "paragraph", "paragraph"]);
    expect(blocks[3]).toEqual({ type: "heading", level: 3, text: "Direct Ownership" });
  });
});

describe("isSafeHref", () => {
  it("allows http/https/mailto", () => {
    expect(isSafeHref("https://example.com")).toBe(true);
    expect(isSafeHref("http://example.com")).toBe(true);
    expect(isSafeHref("mailto:hello@example.com")).toBe(true);
  });

  it("allows a schemeless relative path", () => {
    expect(isSafeHref("/services")).toBe(true);
    expect(isSafeHref("services/pricing")).toBe(true);
  });

  it("rejects javascript: and other executable schemes (the previously identified issue)", () => {
    expect(isSafeHref("javascript:alert(1)")).toBe(false);
    expect(isSafeHref("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeHref("vbscript:msgbox(1)")).toBe(false);
  });

  it("is case-insensitive and tolerant of surrounding whitespace when detecting a scheme", () => {
    expect(isSafeHref(" JavaScript:alert(1) ")).toBe(false);
    expect(isSafeHref(" HTTPS://example.com ")).toBe(true);
  });
});
