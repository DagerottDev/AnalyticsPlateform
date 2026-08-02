import { describe, expect, it } from "vitest";
import { hasFullSessionHistory, mergeOpenInterestSnapshots } from "@/lib/openInterestHistory";
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

describe("open-interest history", () => {
  it("orders snapshots and replaces a local point in the same 30-second bucket", () => {
    const history = mergeOpenInterestSnapshots([
      point("2026-08-03T04:46:00.000Z", 120),
      point("2026-08-03T04:45:01.000Z", 100),
    ], point("2026-08-03T04:45:20.000Z", 110));

    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ timestamp: "2026-08-03T04:45:00.000Z", total_call_oi: 110 });
    expect(history[1].total_call_oi).toBe(120);
  });

  it("identifies full-session history from a 09:15 IST opening observation", () => {
    expect(hasFullSessionHistory([point("2026-08-03T03:45:00.000Z", 100)])).toBe(true);
    expect(hasFullSessionHistory([point("2026-08-03T04:30:00.000Z", 100)])).toBe(false);
  });
});
