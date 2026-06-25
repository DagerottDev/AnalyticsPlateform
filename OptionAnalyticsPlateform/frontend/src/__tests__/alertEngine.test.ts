import { describe, it, expect } from "vitest";

// Extracted evaluation logic for testing
function evaluate(value: number, operator: string, threshold: number): boolean {
  switch (operator) {
    case ">": return value > threshold;
    case "<": return value < threshold;
    case ">=": return value >= threshold;
    case "<=": return value <= threshold;
    default: return false;
  }
}

describe("Alert Engine Logic", () => {
  it("evaluates greater than correctly", () => {
    expect(evaluate(150, ">", 100)).toBe(true);
    expect(evaluate(100, ">", 150)).toBe(false);
    expect(evaluate(100, ">", 100)).toBe(false);
  });

  it("evaluates less than correctly", () => {
    expect(evaluate(50, "<", 100)).toBe(true);
    expect(evaluate(150, "<", 100)).toBe(false);
    expect(evaluate(100, "<", 100)).toBe(false);
  });

  it("evaluates greater than or equal correctly", () => {
    expect(evaluate(150, ">=", 100)).toBe(true);
    expect(evaluate(100, ">=", 100)).toBe(true);
    expect(evaluate(50, ">=", 100)).toBe(false);
  });

  it("evaluates less than or equal correctly", () => {
    expect(evaluate(50, "<=", 100)).toBe(true);
    expect(evaluate(100, "<=", 100)).toBe(true);
    expect(evaluate(150, "<=", 100)).toBe(false);
  });
});
