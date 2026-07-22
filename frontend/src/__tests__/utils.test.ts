import { describe, it, expect } from "vitest";
import { cn, formatINR, formatDate } from "../lib/utils";

describe("cn", () => {
  it("merges class name strings", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("resolves conflicting Tailwind utilities, later wins", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });
});

describe("formatINR", () => {
  it("formats a number as Indian Rupees", () => {
    const result = formatINR(150000);
    expect(result).toContain("1,50,000");
    expect(result).toMatch(/₹/);
  });

  it("handles zero", () => {
    expect(formatINR(0)).toContain("0");
  });
});

describe("formatDate", () => {
  it("returns a dash for null/undefined", () => {
    expect(formatDate(null)).toBe("-");
    expect(formatDate(undefined)).toBe("-");
  });

  it("returns a dash for an invalid date string", () => {
    expect(formatDate("not-a-date")).toBe("-");
  });

  it("formats a valid ISO date string", () => {
    const result = formatDate("2026-01-15T10:30:00Z");
    expect(result).not.toBe("-");
    expect(result.length).toBeGreaterThan(0);
  });

  it("formats a Date object", () => {
    const result = formatDate(new Date("2026-01-15T10:30:00Z"));
    expect(result).not.toBe("-");
  });
});
