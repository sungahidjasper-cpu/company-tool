import { describe, expect, it } from "vitest";

import { extractEarlyFields } from "@/lib/ai/streaming/early-field-extractor";

const BRIEF_FIELDS = ["title", "metaTitle", "metaDescription"] as const;

describe("extractEarlyFields", () => {
  it("returns nothing when no requested field has arrived yet", () => {
    expect(extractEarlyFields('{"tit', BRIEF_FIELDS)).toEqual({});
  });

  it("returns a field only once its closing quote has actually arrived", () => {
    expect(extractEarlyFields('{"title":"Emergency Plumber Austin","metaTitle":"Cut', BRIEF_FIELDS)).toEqual({
      title: "Emergency Plumber Austin",
    });
  });

  it("returns multiple fields once each has fully arrived", () => {
    const text = '{"title":"Emergency Plumber Austin","metaTitle":"Best Plumber","metaDescription":"Fast 24/7 s';
    expect(extractEarlyFields(text, BRIEF_FIELDS)).toEqual({
      title: "Emergency Plumber Austin",
      metaTitle: "Best Plumber",
    });
  });

  it("never returns a field not in the requested allowlist", () => {
    const text = '{"title":"Foo","outline":["a","b"]}';
    expect(extractEarlyFields(text, ["title"])).toEqual({ title: "Foo" });
  });

  it("ignores a requested field whose value is an array or object, not a scalar string", () => {
    const text = '{"title":"Foo","outline":["a","b"]}';
    expect(extractEarlyFields(text, ["title", "outline"])).toEqual({ title: "Foo" });
  });

  it("returns an empty object for non-JSON or fully-unparseable text", () => {
    expect(extractEarlyFields("not json at all", BRIEF_FIELDS)).toEqual({});
  });
});
