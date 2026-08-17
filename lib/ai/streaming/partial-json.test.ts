import { describe, expect, it } from "vitest";

import { parsePartialJson } from "@/lib/ai/streaming/partial-json";

describe("parsePartialJson", () => {
  it("returns the full object when the text is already complete, valid JSON", () => {
    expect(parsePartialJson('{"title":"Foo","count":3}')).toEqual({ title: "Foo", count: 3 });
  });

  it("returns undefined for an empty string", () => {
    expect(parsePartialJson("")).toBeUndefined();
  });

  it("backs off to an empty object when no field has completed yet, rather than guessing", () => {
    expect(parsePartialJson("{")).toEqual({});
    expect(parsePartialJson('{"tit')).toEqual({});
  });

  it("backs off to an empty array when no element has completed yet", () => {
    expect(parsePartialJson("[")).toEqual([]);
  });

  it("drops a field truncated mid-key, keeping only the fields before it", () => {
    const truncated = '{"title":"Foo","outline":["a","b"],"meta';
    expect(parsePartialJson(truncated)).toEqual({ title: "Foo", outline: ["a", "b"] });
  });

  it("drops a field truncated mid-value string, never guessing the partial string", () => {
    const truncated = '{"title":"Foo","metaTitle":"Best Plumbers in Aus';
    expect(parsePartialJson(truncated)).toEqual({ title: "Foo" });
  });

  it("drops a key truncated right after the colon with no value at all", () => {
    const truncated = '{"title":"Foo","metaTitle":';
    expect(parsePartialJson(truncated)).toEqual({ title: "Foo" });
  });

  it("drops an array truncated mid-element", () => {
    const truncated = '{"outline":["Introduction","Signs of an emerg';
    expect(parsePartialJson(truncated)).toEqual({ outline: ["Introduction"] });
  });

  it("keeps a fully-closed sibling array plus whatever keys of a trailing partial object have already arrived", () => {
    const truncated = '{"outline":["Introduction","Conclusion"],"faq":[{"question":"Q1","answ';
    expect(parsePartialJson(truncated)).toEqual({ outline: ["Introduction", "Conclusion"], faq: [{ question: "Q1" }] });
  });

  it("keeps a fully-closed nested object plus whatever keys of a trailing partial sibling object have arrived", () => {
    const truncated = '{"faq":[{"question":"Q1","answer":"A1"},{"question":"Q2","answ';
    expect(parsePartialJson(truncated)).toEqual({ faq: [{ question: "Q1", answer: "A1" }, { question: "Q2" }] });
  });

  it("drops a trailing dangling comma before closing", () => {
    const truncated = '{"title":"Foo",';
    expect(parsePartialJson(truncated)).toEqual({ title: "Foo" });
  });

  it("never returns a value for a field truncated immediately after its opening quote", () => {
    const truncated = '{"title":"Foo","metaDescription":"';
    expect(parsePartialJson(truncated)).toEqual({ title: "Foo" });
  });

  it("handles a string value containing an escaped quote without treating it as a close", () => {
    const complete = '{"title":"He said \\"hi\\""}';
    expect(parsePartialJson(complete)).toEqual({ title: 'He said "hi"' });
  });

  it("does not mistake a brace/bracket inside a string for real structure", () => {
    const truncated = '{"title":"Section {A} and [B]","metaTitle":"Cut he';
    expect(parsePartialJson(truncated)).toEqual({ title: "Section {A} and [B]" });
  });

  it("returns undefined for non-JSON prose text", () => {
    expect(parsePartialJson("The article discusses self-storage investing")).toBeUndefined();
  });
});
