import { describe, expect, it } from "vitest";
import { formatStrikeWithPosition, getStrikePosition, strikePositionLabel } from "@/lib/strikePositions";

describe("strike position labels", () => {
  const strikes = [21900, 22000, 22100, 22200];

  it("marks the closest ladder strike as ATM", () => {
    expect(getStrikePosition(22000, strikes, 22035)).toMatchObject({
      atmStrike: 22000,
      distance: 0,
      call: "ATM",
      put: "ATM",
    });
  });

  it("uses opposite OTM/ITM directions for calls and puts", () => {
    expect(strikePositionLabel(22200, strikes, 22000, "CE")).toBe("OTM 2");
    expect(strikePositionLabel(22200, strikes, 22000, "PE")).toBe("ITM 2");
    expect(strikePositionLabel(21900, strikes, 22000, "BOTH")).toBe("CE ITM 1 / PE OTM 1");
  });

  it("includes the position in the visible picker label", () => {
    expect(formatStrikeWithPosition(22100, strikes, 22000, "CE")).toBe("22,100 · OTM 1");
  });
});
