import { describe, expect, it } from "vitest";
import { describeDataFreshness } from "@/lib/dataFreshness";

describe("describeDataFreshness", () => {
  // 31 Jul 2026, 11:00 IST — inside the regular NSE session.
  const now = Date.parse("2026-07-31T05:30:00Z");

  it("normalizes second timestamps and identifies fresh quotes", () => {
    expect(describeDataFreshness({ timestamp: now / 1000 - 5 }, now)).toMatchObject({
      state: "live",
      label: "Live",
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

  it("uses the applicable post-CAS close for each market segment", () => {
    // 3 Aug 2026, 15:35 IST: F&O is open; cash equity is closed.
    const at1535 = Date.parse("2026-08-03T10:05:00Z");
    expect(describeDataFreshness({ timestamp: at1535 }, at1535, "fno").state).toBe("live");
    expect(describeDataFreshness({ timestamp: at1535 }, at1535, "cash").state).toBe("closed");
  });

  it("trusts a fresh broker stream during an extended session", () => {
    const at1545 = Date.parse("2026-08-05T10:15:00Z"); // 15:45 IST, after the calendar close
    expect(describeDataFreshness({
      timestamp: at1545,
      feed: "stream",
      last_stream_timestamp: at1545,
    }, at1545, "fno").state).toBe("live");
  });
});
