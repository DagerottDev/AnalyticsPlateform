import { describe, expect, it } from "vitest";
import { normalizeOpenInterestSeries } from "@/lib/openInterestChart";
import type { OpenInterestSnapshot } from "@/lib/market";

function point(timestamp: string, callOi: number): OpenInterestSnapshot {
  return {
    timestamp,
    total_call_oi: callOi,
    total_put_oi: 200,
    total_call_change: 10,
    total_put_change: -5,
  };
}

describe("open-interest chart data", () => {
  it("sorts, deduplicates, and drops invalid snapshots before charting", () => {
    const rows = normalizeOpenInterestSeries([
      point("2026-08-04T09:16:00.200Z", 130),
      point("2026-08-04T09:15:00.100Z", 100),
      point("2026-08-04T09:15:00.900Z", 110),
      point("not-a-date", 999),
    ], "total_call_oi");

    expect(rows).toEqual([
      { time: Date.parse("2026-08-04T09:15:00Z") / 1000, value: 110 },
      { time: Date.parse("2026-08-04T09:16:00Z") / 1000, value: 130 },
    ]);
  });
});
