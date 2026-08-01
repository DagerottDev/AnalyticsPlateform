import { describe, expect, it } from "vitest";
import { recentMarketDateRange } from "@/lib/recentHistory";

describe("recent market history range", () => {
  it("uses the current IST session once the regular market is open", () => {
    expect(recentMarketDateRange(new Date("2026-07-31T04:00:00Z"))).toEqual({ from: "2026-07-31", to: "2026-07-31" });
  });

  it("uses the latest weekday while the market is closed on a weekend", () => {
    expect(recentMarketDateRange(new Date("2026-08-01T04:00:00Z"))).toEqual({ from: "2026-07-31", to: "2026-07-31" });
    expect(recentMarketDateRange(new Date("2026-08-02T04:00:00Z"))).toEqual({ from: "2026-07-31", to: "2026-07-31" });
  });

  it("uses the previous weekday before the regular open", () => {
    expect(recentMarketDateRange(new Date("2026-07-31T03:00:00Z"))).toEqual({ from: "2026-07-30", to: "2026-07-30" });
  });
});
