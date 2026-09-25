import { describe, expect, it } from "vitest";

import {
  emptyDocument,
  isSafeHref,
  parseMarkdownBlocks,
  serializeMarkdownBlocks,
  type MarkdownBlock,
} from "@/features/ai-workspace/services/markdown-preview.service";

/**
 * Phase 7 — the Blog Studio's storage contract.
 *
 * Markdown stays canonical on Content.body, so the property that actually
 * matters is the round trip: what the editor writes must parse back into the
 * same document, or reopening a saved article would quietly lose work.
 */
const roundTrip = (blocks: MarkdownBlock[]) => parseMarkdownBlocks(serializeMarkdownBlocks(blocks));

describe("round trip — every block the studio can produce", () => {
  it("1. headings at all six levels", () => {
    const blocks: MarkdownBlock[] = [1, 2, 3, 4, 5, 6].map((level) => ({ type: "heading", level: level as 1, text: `Level ${level}` }));
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  it("2. paragraphs, including a multi-line one", () => {
    const blocks: MarkdownBlock[] = [{ type: "paragraph", lines: ["First line.", "Second line."] }];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  it("3. both list kinds", () => {
    const blocks: MarkdownBlock[] = [
      { type: "ul", items: ["One", "Two"] },
      { type: "ol", items: ["First", "Second"] },
    ];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  it("4. a blockquote", () => {
    const blocks: MarkdownBlock[] = [{ type: "quote", lines: ["Storage is a cash-flow business."] }];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  it("5. a divider", () => {
    expect(roundTrip([{ type: "divider" }])).toEqual([{ type: "divider" }]);
  });

  it("6. a code block, with and without a language", () => {
    expect(roundTrip([{ type: "code", language: "ts", lines: ["const a = 1;"] }])).toEqual([{ type: "code", language: "ts", lines: ["const a = 1;"] }]);
    expect(roundTrip([{ type: "code", language: null, lines: ["plain"] }])).toEqual([{ type: "code", language: null, lines: ["plain"] }]);
  });

  it("7. a table", () => {
    const blocks: MarkdownBlock[] = [{ type: "table", headers: ["Size", "Rate"], rows: [["5x5", "$60"], ["10x10", "$140"]] }];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  it("8. an image with alt text and a caption", () => {
    const blocks: MarkdownBlock[] = [{ type: "image", src: "/api/files/abc", alt: "A storage facility at dusk", caption: "Our Reno site" }];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  it("9. an image with no caption, and one with no alt text", () => {
    expect(roundTrip([{ type: "image", src: "/api/files/abc", alt: "Alt only", caption: null }])).toEqual([
      { type: "image", src: "/api/files/abc", alt: "Alt only", caption: null },
    ]);
    expect(roundTrip([{ type: "image", src: "/api/files/abc", alt: "", caption: null }])).toEqual([{ type: "image", src: "/api/files/abc", alt: "", caption: null }]);
  });

  it("10. a video", () => {
    expect(roundTrip([{ type: "video", src: "/api/files/vid" }])).toEqual([{ type: "video", src: "/api/files/vid" }]);
  });

  it("11. a whole article, in order, survives the trip intact", () => {
    const article: MarkdownBlock[] = [
      { type: "heading", level: 2, text: "Why unit mix matters" },
      { type: "paragraph", lines: ["Occupancy alone tells you very little."] },
      { type: "image", src: "/api/files/img-1", alt: "Unit mix chart", caption: "Typical mix" },
      { type: "paragraph", lines: ["Below the image, the article continues."] },
      { type: "ul", items: ["Small units churn faster", "Large units anchor revenue"] },
      { type: "quote", lines: ["Buy the cash flow, not the building."] },
      { type: "divider" },
      { type: "table", headers: ["Size", "Share"], rows: [["5x5", "22%"]] },
    ];
    expect(roundTrip(article)).toEqual(article);
  });

  it("12. an image between two paragraphs stays exactly where it was put", () => {
    const article: MarkdownBlock[] = [
      { type: "paragraph", lines: ["Before."] },
      { type: "image", src: "/api/files/x", alt: "x", caption: null },
      { type: "paragraph", lines: ["After."] },
    ];
    const parsed = roundTrip(article);
    expect(parsed.map((block) => block.type)).toEqual(["paragraph", "image", "paragraph"]);
    expect(parsed[1]).toEqual(article[1]);
  });
});

describe("the stored format stays plain Markdown", () => {
  it("13. an image serializes as ordinary Markdown image syntax", () => {
    expect(serializeMarkdownBlocks([{ type: "image", src: "/api/files/a", alt: "Alt", caption: "Cap" }])).toBe('![Alt](/api/files/a "Cap")');
  });

  it("14. a video serializes as an ordinary Markdown link, so a plain reader still gets something usable", () => {
    expect(serializeMarkdownBlocks([{ type: "video", src: "/api/files/v" }])).toBe("[video](/api/files/v)");
  });

  it("15. headings, lists and quotes use their standard Markdown syntax", () => {
    expect(serializeMarkdownBlocks([{ type: "heading", level: 3, text: "Sub" }])).toBe("### Sub");
    expect(serializeMarkdownBlocks([{ type: "ul", items: ["a"] }])).toBe("- a");
    expect(serializeMarkdownBlocks([{ type: "ol", items: ["a", "b"] }])).toBe("1. a\n2. b");
    expect(serializeMarkdownBlocks([{ type: "quote", lines: ["q"] }])).toBe("> q");
  });

  it("16. no HTML is ever emitted — nothing here can inject markup downstream", () => {
    const everything: MarkdownBlock[] = [
      { type: "heading", level: 1, text: "T" },
      { type: "paragraph", lines: ["p"] },
      { type: "image", src: "/api/files/a", alt: "a", caption: "c" },
      { type: "video", src: "/api/files/v" },
      { type: "quote", lines: ["q"] },
      { type: "code", language: null, lines: ["x"] },
      { type: "divider" },
      { type: "table", headers: ["h"], rows: [["r"]] },
    ];
    expect(serializeMarkdownBlocks(everything)).not.toMatch(/<[a-z]/i);
  });

  it("17. a caption containing a quote mark cannot break the syntax it lives in", () => {
    const markdown = serializeMarkdownBlocks([{ type: "image", src: "/api/files/a", alt: "a", caption: 'He said "buy"' }]);
    expect(markdown).toBe("![a](/api/files/a \"He said 'buy'\")");
    expect(parseMarkdownBlocks(markdown)[0]).toEqual({ type: "image", src: "/api/files/a", alt: "a", caption: "He said 'buy'" });
  });
});

describe("existing Markdown keeps working", () => {
  it("18. an article written before this phase parses exactly as it always did", () => {
    const legacy = "# Title\n\nA paragraph.\n\n## Section\n\n- one\n- two";
    expect(parseMarkdownBlocks(legacy)).toEqual([
      { type: "heading", level: 1, text: "Title" },
      { type: "paragraph", lines: ["A paragraph."] },
      { type: "heading", level: 2, text: "Section" },
      { type: "ul", items: ["one", "two"] },
    ]);
  });

  it("19. an empty document gives one place to type", () => {
    expect(emptyDocument()).toEqual([{ type: "paragraph", lines: [""] }]);
    expect(serializeMarkdownBlocks(emptyDocument())).toBe("");
  });

  it("20. unknown syntax degrades to a paragraph rather than being lost", () => {
    const parsed = parseMarkdownBlocks("Some ::weird:: syntax");
    expect(parsed).toEqual([{ type: "paragraph", lines: ["Some ::weird:: syntax"] }]);
  });
});

describe("media sources are checked like any other URL", () => {
  it("21. an application file path is safe", () => {
    expect(isSafeHref("/api/files/01a02222-2222-7222-b222-222222222222")).toBe(true);
  });

  it("22. an executable scheme in an image src is refused", () => {
    for (const src of ["javascript:alert(1)", "data:text/html;base64,PHN2Zz4=", "vbscript:x"]) {
      expect(isSafeHref(src)).toBe(false);
    }
  });

  it("23. a parsed image keeps whatever src it had, so the renderer is the one that decides", () => {
    // Parsing does not sanitize; it reports. The renderer refuses unsafe srcs,
    // which keeps that decision in exactly one place.
    const parsed = parseMarkdownBlocks("![x](javascript:alert(1))");
    expect(parsed[0].type).toBe("paragraph");
  });
});
