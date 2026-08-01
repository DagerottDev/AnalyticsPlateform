import { describe, expect, it } from "vitest";
import { describeDataFreshness } from "@/lib/dataFreshness";

describe("describeDataFreshness", () => {
  // 31 Jul 2026, 11:00 IST — inside the regular NSE session.
  const now = Date.parse("2026-07-31T05:30:00Z");

  it("normalizes second timestamps and identifies fresh quotes", () => {
    expect(describeDataFreshness({ timestamp: now / 1000 - 5 }, now)).toMatchObject({
      state: "live",
      label: "Live · 5s ago",
    });
  });

  it("makes delayed, stale, and missing quotes explicit", () => {
    expect(describeDataFreshness({ timestamp: now - 30_000 }, now).state).toBe("delayed");
    expect(describeDataFreshness({ timestamp: now - 61_000 }, now).state).toBe("stale");
    expect(describeDataFreshness(null, now)).toMatchObject({ state: "waiting" });
  });

  it("never presents an after-hours quote as live", () => {
    const afterHours = Date.parse("2026-07-31T18:21:00Z");
    expect(describeDataFreshness({ timestamp: afterHours }, afterHours)).toMatchObject({
      state: "closed",
      label: "Market closed",
    });
  });
});
