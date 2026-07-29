import { describe, expect, it } from "vitest";
import { describeDataFreshness } from "@/lib/dataFreshness";

describe("describeDataFreshness", () => {
  const now = 1_700_000_000_000;

  it("normalizes second timestamps and identifies fresh quotes", () => {
    expect(describeDataFreshness({ timestamp: 1_699_999_995 }, now)).toMatchObject({
      state: "live",
      label: "Live · 5s ago",
    });
  });

  it("makes delayed, stale, and missing quotes explicit", () => {
    expect(describeDataFreshness({ timestamp: now - 30_000 }, now).state).toBe("delayed");
    expect(describeDataFreshness({ timestamp: now - 61_000 }, now).state).toBe("stale");
    expect(describeDataFreshness(null, now)).toMatchObject({ state: "waiting" });
  });
});
