import { describe, expect, it } from "vitest";
import { supertrendColor, SUPERTREND_DOWN_COLOR, SUPERTREND_UP_COLOR } from "@/lib/supertrendColors";

describe("supertrend colors", () => {
  it("uses the conventional green bullish and red bearish colors", () => {
    expect(supertrendColor("up")).toBe(SUPERTREND_UP_COLOR);
    expect(supertrendColor("down")).toBe(SUPERTREND_DOWN_COLOR);
    expect(SUPERTREND_UP_COLOR).toBe("#2dd4a7");
    expect(SUPERTREND_DOWN_COLOR).toBe("#ff6b7a");
  });
});
