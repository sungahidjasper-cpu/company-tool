import { describe, expect, it } from "vitest";
import { parsePreviewFields } from "./partial-json-preview.service";

describe("parsePreviewFields", () => {
  it("returns nothing for empty or pre-brace text", () => {
    expect(parsePreviewFields("")).toEqual({});
    expect(parsePreviewFields("   ")).toEqual({});
    expect(parsePreviewFields('"title')).toEqual({});
  });

  it("returns nothing while the first key is still being written", () => {
    expect(parsePreviewFields('{"tit')).toEqual({});
    expect(parsePreviewFields("{")).toEqual({});
  });

  it("returns nothing while the first value is still an incomplete string", () => {
    expect(parsePreviewFields('{"title": "Best Storage')).toEqual({});
  });

  it("exposes a single complete scalar field", () => {
    expect(parsePreviewFields('{"title": "Best Storage Units"')).toEqual({
      title: "Best Storage Units",
    });
  });

  it("exposes multiple complete scalar fields of mixed types", () => {
    const text = '{"title": "Hello", "score": 42, "active": true, "notes": null,';
    expect(parsePreviewFields(text)).toEqual({
      title: "Hello",
      score: 42,
      active: true,
      notes: null,
    });
  });

  it("stops at the first incomplete field and does not include it", () => {
    const text = '{"title": "Hello", "metaTitle": "Best Sto';
    expect(parsePreviewFields(text)).toEqual({ title: "Hello" });
  });

  it("treats a bare number at end-of-text as incomplete (could still grow)", () => {
    expect(parsePreviewFields('{"score": 4')).toEqual({});
  });

  it("accepts a bare number once an unambiguous terminator follows", () => {
    expect(parsePreviewFields('{"score": 42}')).toEqual({ score: 42 });
    expect(parsePreviewFields('{"score": 42,')).toEqual({ score: 42 });
  });

  it("handles escaped characters inside strings without breaking boundary detection", () => {
    const text = String.raw`{"title": "Say \"hi\" to a backslash \\ here",`;
    expect(parsePreviewFields(text)).toEqual({
      title: 'Say "hi" to a backslash \\ here',
    });
  });

  it("does not treat a brace/bracket inside a string as real structure", () => {
    const text = '{"title": "Contains { and [ and ] and }",';
    expect(parsePreviewFields(text)).toEqual({
      title: "Contains { and [ and ] and }",
    });
  });

  it("exposes a fully complete nested object field", () => {
    const text = '{"meta": {"a": 1, "b": "two"}, "title": "Hi"';
    expect(parsePreviewFields(text)).toEqual({
      meta: { a: 1, b: "two" },
      title: "Hi",
    });
  });

  it("does not expose a nested object field that is still open", () => {
    const text = '{"meta": {"a": 1, "b": "two"';
    expect(parsePreviewFields(text)).toEqual({});
  });

  it("exposes already-complete elements of a still-open top-level array", () => {
    const text = '{"outline": ["Intro", "History", "Bene';
    expect(parsePreviewFields(text)).toEqual({
      outline: ["Intro", "History"],
    });
  });

  it("exposes an empty array as soon as the opening bracket appears with no elements yet", () => {
    expect(parsePreviewFields('{"outline": [')).toEqual({ outline: [] });
  });

  it("exposes a fully closed array and continues scanning fields after it", () => {
    const text = '{"outline": ["A", "B"], "title": "Done"';
    expect(parsePreviewFields(text)).toEqual({
      outline: ["A", "B"],
      title: "Done",
    });
  });

  it("stops at a still-open array and does not show fields declared after it", () => {
    const text = '{"outline": ["A", "B", "C incomplete';
    expect(parsePreviewFields(text)).toEqual({
      outline: ["A", "B"],
    });
  });

  it("exposes already-complete object elements inside an array of objects (e.g. faq/sections)", () => {
    const text =
      '{"faq": [{"question": "Q1", "answer": "A1"}, {"question": "Q2", "answer": "A2"}, {"question": "Q3 still writ';
    expect(parsePreviewFields(text)).toEqual({
      faq: [
        { question: "Q1", answer: "A1" },
        { question: "Q2", answer: "A2" },
      ],
    });
  });

  it("handles a fully valid, closed JSON object", () => {
    const text = '{"title": "T", "outline": ["A", "B"], "faq": [{"question": "Q", "answer": "A"}]}';
    expect(parsePreviewFields(text)).toEqual({
      title: "T",
      outline: ["A", "B"],
      faq: [{ question: "Q", answer: "A" }],
    });
  });

  it("handles incremental accumulation converging to the final parsed shape", () => {
    const full = '{"title": "Storage Guide", "outline": ["Intro", "Pricing", "FAQ"], "score": 7}';
    let previous: Record<string, unknown> = {};
    for (let i = 1; i <= full.length; i++) {
      const partial = full.slice(0, i);
      const fields = parsePreviewFields(partial);
      // Once a key appears, it must never disappear on a later, longer partial, a scalar
      // must never change value, and an array may only ever grow by appending elements —
      // the defining safety property of a live, never-repair, never-rewrite preview.
      for (const key of Object.keys(previous)) {
        expect(fields).toHaveProperty(key);
        const prevValue = previous[key];
        const nextValue = fields[key];
        if (Array.isArray(prevValue)) {
          expect(Array.isArray(nextValue)).toBe(true);
          expect((nextValue as unknown[]).slice(0, prevValue.length)).toEqual(prevValue);
        } else {
          expect(nextValue).toEqual(prevValue);
        }
      }
      previous = fields;
    }
    expect(previous).toEqual({
      title: "Storage Guide",
      outline: ["Intro", "Pricing", "FAQ"],
      score: 7,
    });
  });

  it("never throws on malformed or nonsensical input", () => {
    expect(() => parsePreviewFields("not json at all")).not.toThrow();
    expect(() => parsePreviewFields("{]}[{")).not.toThrow();
    expect(() => parsePreviewFields('{"key": }')).not.toThrow();
    expect(() => parsePreviewFields('{"key": ,}')).not.toThrow();
    expect(parsePreviewFields("not json at all")).toEqual({});
  });

  it("is stateless — calling with a shorter/reset string after a longer one starts fresh", () => {
    const long = '{"title": "Full Title", "outline": ["A", "B"]}';
    const afterLong = parsePreviewFields(long);
    expect(afterLong).toEqual({ title: "Full Title", outline: ["A", "B"] });

    // Simulates a "reset" event where accumulated text restarts from empty.
    const afterReset = parsePreviewFields("");
    expect(afterReset).toEqual({});

    const newPartial = parsePreviewFields('{"title": "New Draft');
    expect(newPartial).toEqual({});
  });

  it("ignores whitespace/newlines between tokens", () => {
    const text = `{
      "title": "Hello",
      "outline": [
        "A",
        "B"
      ],
      "score": 5
    }`;
    expect(parsePreviewFields(text)).toEqual({
      title: "Hello",
      outline: ["A", "B"],
      score: 5,
    });
  });

  it("stops scanning once a key is malformed (not a quoted string)", () => {
    const text = '{"title": "Hello", invalidKey: "x"';
    expect(parsePreviewFields(text)).toEqual({ title: "Hello" });
  });
});
