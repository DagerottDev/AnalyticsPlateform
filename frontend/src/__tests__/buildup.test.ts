import { describe, it, expect } from "vitest";
import { classifyBuildup } from "../lib/buildup";

describe("classifyBuildup", () => {
  it("classifies price up + OI up as Long Buildup", () => {
    expect(classifyBuildup(2.5, 10)?.category).toBe("Long Buildup");
  });

  it("classifies price down + OI up as Short Buildup", () => {
    expect(classifyBuildup(-3.1, 8)?.category).toBe("Short Buildup");
  });

  it("classifies price down + OI down as Long Unwinding", () => {
    expect(classifyBuildup(-1.2, -6)?.category).toBe("Long Unwinding");
  });

  it("classifies price up + OI down as Short Covering", () => {
    expect(classifyBuildup(1.8, -4)?.category).toBe("Short Covering");
  });

  it("treats sub-threshold moves as Neutral rather than flip-flopping", () => {
    expect(classifyBuildup(0.01, 10)?.category).toBe("Neutral");
    expect(classifyBuildup(5, 0.01)?.category).toBe("Neutral");
  });

  it("returns null when either input is missing", () => {
    expect(classifyBuildup(null, 10)).toBeNull();
    expect(classifyBuildup(5, undefined)).toBeNull();
  });
});
