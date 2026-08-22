import { describe, expect, it } from "vitest";

import {
  connectDestinationInputSchema,
  disconnectDestinationInputSchema,
  updateConnectionLabelInputSchema,
} from "@/features/publishing/schemas/publishing-connection.schema";

describe("connectDestinationInputSchema", () => {
  const valid = {
    label: "Acme Blog",
    baseUrl: "https://blog.acme.test",
    username: "admin",
    applicationPassword: "abcd 1234 EFGH 5678",
  };

  it("accepts a valid input", () => {
    expect(connectDestinationInputSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a non-https base URL", () => {
    const result = connectDestinationInputSchema.safeParse({ ...valid, baseUrl: "http://blog.acme.test" });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed base URL", () => {
    const result = connectDestinationInputSchema.safeParse({ ...valid, baseUrl: "not a url" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty label", () => {
    const result = connectDestinationInputSchema.safeParse({ ...valid, label: "" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty username or application password", () => {
    expect(connectDestinationInputSchema.safeParse({ ...valid, username: "" }).success).toBe(false);
    expect(connectDestinationInputSchema.safeParse({ ...valid, applicationPassword: "" }).success).toBe(false);
  });

  it("has no companyId field in its shape", () => {
    expect(Object.keys(connectDestinationInputSchema.shape)).not.toContain("companyId");
  });
});

describe("updateConnectionLabelInputSchema", () => {
  it("accepts a valid input", () => {
    expect(updateConnectionLabelInputSchema.safeParse({ connectionId: "id", label: "New label" }).success).toBe(true);
  });

  it("rejects an empty label", () => {
    expect(updateConnectionLabelInputSchema.safeParse({ connectionId: "id", label: "" }).success).toBe(false);
  });
});

describe("disconnectDestinationInputSchema", () => {
  it("accepts a valid input", () => {
    expect(disconnectDestinationInputSchema.safeParse({ connectionId: "id" }).success).toBe(true);
  });

  it("rejects a missing connectionId", () => {
    expect(disconnectDestinationInputSchema.safeParse({}).success).toBe(false);
  });
});
