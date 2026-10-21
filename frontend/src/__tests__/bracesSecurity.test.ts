import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const braces = createRequire(import.meta.url)("braces");

describe("patched lint glob parser", () => {
  it("rejects deep braces, parentheses and mixed nesting before recursive compilation", () => {
    for (const pattern of [
      "{".repeat(4000) + "a" + "}".repeat(4000),
      "{".repeat(4000),
      "(".repeat(4999) + "a" + ")".repeat(4999),
      "({".repeat(40) + "a" + "})".repeat(40),
    ]) {
      expect(() => braces.compile(pattern)).toThrow("Pattern nesting exceeds 64");
      expect(() => braces.expand(pattern)).toThrow("Pattern nesting exceeds 64");
    }
  });

  it("preserves normal glob, range and escaped-brace behavior", () => {
    expect(braces.expand("src/**/*.{ts,tsx}")).toEqual(["src/**/*.ts", "src/**/*.tsx"]);
    expect(braces.expand("{1..3}")).toEqual(["1", "2", "3"]);
    expect(braces("\\{literal\\}")).toEqual(["{literal}"]);
    expect(() => braces.parse("{".repeat(64) + "a" + "}".repeat(64))).not.toThrow();
    expect(() => braces.parse("(".repeat(64) + "a" + ")".repeat(64))).not.toThrow();
  });
});
