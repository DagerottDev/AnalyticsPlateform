import { describe, it, expect } from "vitest";
import { formatApiError } from "../lib/apiError";

describe("formatApiError", () => {
  it("returns an empty string for a falsy error", () => {
    expect(formatApiError(null)).toBe("");
    expect(formatApiError(undefined)).toBe("");
  });

  it("returns a plain string error as-is", () => {
    expect(formatApiError("boom")).toBe("boom");
  });

  it("formats a response error with object data", () => {
    const err = { response: { status: 500, data: { detail: "Internal error" } } };
    const result = formatApiError(err);
    expect(result).toContain("Status: 500");
    expect(result).toContain('"detail": "Internal error"');
  });

  it("formats a response error with string data", () => {
    const err = { response: { status: 404, data: "Not found" } };
    const result = formatApiError(err);
    expect(result).toContain("Status: 404");
    expect(result).toContain("Data: Not found");
  });

  it("formats a network error with no response", () => {
    const err = { request: {}, message: "timeout of 5000ms exceeded" };
    const result = formatApiError(err);
    expect(result).toContain("Network Error");
    expect(result).toContain("timeout of 5000ms exceeded");
  });

  it("falls back to the error message when neither response nor request is present", () => {
    expect(formatApiError({ message: "Something broke" })).toBe("Something broke");
  });

  it("falls back to a generic message when nothing is available", () => {
    expect(formatApiError({})).toBe("Unknown error occurred");
  });
});
