import { describe, expect, it } from "vitest";

import { contentSchema } from "@/features/seo/schemas/content.schema";

const BASE_INPUT = {
  title: "How to Fix a Leaky Faucet",
  url: "",
  status: "DRAFT" as const,
  publishedAt: "",
  authorId: "",
};

describe("contentSchema — body field (Phase 16)", () => {
  it("accepts a normal Markdown body string", () => {
    const result = contentSchema.safeParse({ ...BASE_INPUT, body: "## Introduction\n\nSome text." });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.body).toBe("## Introduction\n\nSome text.");
    }
  });

  it("normalizes a blank body to undefined, matching every other optional text field", () => {
    const result = contentSchema.safeParse({ ...BASE_INPUT, body: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.body).toBeUndefined();
    }
  });

  it("treats an omitted body the same as a blank one", () => {
    const result = contentSchema.safeParse(BASE_INPUT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.body).toBeUndefined();
    }
  });

  it("still validates the rest of the schema unaffected by the new field", () => {
    const result = contentSchema.safeParse({ ...BASE_INPUT, title: "x" });
    expect(result.success).toBe(false);
  });
});
