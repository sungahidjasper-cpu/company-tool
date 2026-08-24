import { describe, expect, it } from "vitest";

import { classifyNetworkFailure, classifyWordPressStatusCode } from "@/features/publishing/services/publishing-errors";

describe("classifyWordPressStatusCode", () => {
  it("classifies a bare 401 as AUTHENTICATION_FAILED", () => {
    expect(classifyWordPressStatusCode(401, "")).toBe("AUTHENTICATION_FAILED");
  });

  it("classifies a 401 with a recognized auth-failure code as AUTHENTICATION_FAILED", () => {
    const body = JSON.stringify({ code: "incorrect_password", message: "Incorrect password." });
    expect(classifyWordPressStatusCode(401, body)).toBe("AUTHENTICATION_FAILED");
  });

  it("classifies a 403 with a recognized permission code as INSUFFICIENT_PERMISSIONS", () => {
    const body = JSON.stringify({ code: "rest_cannot_create", message: "Sorry, you are not allowed to create posts." });
    expect(classifyWordPressStatusCode(403, body)).toBe("INSUFFICIENT_PERMISSIONS");
  });

  it("classifies an unrecognized 403 body as AUTHENTICATION_FAILED (safe default)", () => {
    const body = JSON.stringify({ code: "some_unknown_code" });
    expect(classifyWordPressStatusCode(403, body)).toBe("AUTHENTICATION_FAILED");
  });

  it("classifies a 403 with an unparseable body as AUTHENTICATION_FAILED", () => {
    expect(classifyWordPressStatusCode(403, "not json")).toBe("AUTHENTICATION_FAILED");
  });

  it("classifies 429 as RATE_LIMITED", () => {
    expect(classifyWordPressStatusCode(429, "")).toBe("RATE_LIMITED");
  });

  it("classifies 400 and 422 as VALIDATION_FAILED", () => {
    expect(classifyWordPressStatusCode(400, "")).toBe("VALIDATION_FAILED");
    expect(classifyWordPressStatusCode(422, "")).toBe("VALIDATION_FAILED");
  });

  it("classifies 409 as DUPLICATE_RESOURCE", () => {
    expect(classifyWordPressStatusCode(409, "")).toBe("DUPLICATE_RESOURCE");
  });

  it("classifies every 5xx as DESTINATION_UNAVAILABLE", () => {
    expect(classifyWordPressStatusCode(500, "")).toBe("DESTINATION_UNAVAILABLE");
    expect(classifyWordPressStatusCode(502, "")).toBe("DESTINATION_UNAVAILABLE");
    expect(classifyWordPressStatusCode(503, "")).toBe("DESTINATION_UNAVAILABLE");
  });

  it("classifies a 3xx (never followed by the guard) as AMBIGUOUS_RESPONSE", () => {
    expect(classifyWordPressStatusCode(301, "")).toBe("AMBIGUOUS_RESPONSE");
    expect(classifyWordPressStatusCode(302, "")).toBe("AMBIGUOUS_RESPONSE");
  });

  it("falls back to UNKNOWN for an unrecognized status code", () => {
    expect(classifyWordPressStatusCode(418, "")).toBe("UNKNOWN");
  });

  it("does not conflate authentication, permission, rate-limit, and validation cases", () => {
    const results = new Set([
      classifyWordPressStatusCode(401, ""),
      classifyWordPressStatusCode(403, JSON.stringify({ code: "rest_cannot_create" })),
      classifyWordPressStatusCode(429, ""),
      classifyWordPressStatusCode(400, ""),
    ]);
    expect(results.size).toBe(4);
  });
});

describe("classifyNetworkFailure", () => {
  it("classifies a never-connected DNS failure as NETWORK_TIMEOUT (safe to retry)", () => {
    const err = Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
    expect(classifyNetworkFailure(err)).toBe("NETWORK_TIMEOUT");
  });

  it("classifies a connection-refused failure as NETWORK_TIMEOUT (safe to retry)", () => {
    const err = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    expect(classifyNetworkFailure(err)).toBe("NETWORK_TIMEOUT");
  });

  it("classifies a generic request-timeout error with no code as AMBIGUOUS_RESPONSE", () => {
    const err = new Error("Request to the destination timed out.");
    expect(classifyNetworkFailure(err)).toBe("AMBIGUOUS_RESPONSE");
  });

  it("classifies a mid-request reset as AMBIGUOUS_RESPONSE, not a safe retry", () => {
    const err = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    expect(classifyNetworkFailure(err)).toBe("AMBIGUOUS_RESPONSE");
  });

  it("falls back safely to AMBIGUOUS_RESPONSE for a completely unrecognized error shape", () => {
    expect(classifyNetworkFailure("not even an Error object")).toBe("AMBIGUOUS_RESPONSE");
    expect(classifyNetworkFailure(undefined)).toBe("AMBIGUOUS_RESPONSE");
  });
});
