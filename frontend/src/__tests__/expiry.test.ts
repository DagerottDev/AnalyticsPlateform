import { describe, expect, it } from "vitest";
import { latestExpiry, sortExpiries } from "../lib/expiry";

describe("expiry defaults", () => {
  it("selects the furthest date regardless of broker ordering", () => {
    expect(latestExpiry(["07-Aug-2026", "31-Jul-2026", "14-Aug-2026"])).toBe("14-Aug-2026");
  });

  it("supports both broker labels and ISO dates", () => {
    expect(latestExpiry(["2026-08-27", "28-Aug-2026", "2026-08-20"])).toBe("28-Aug-2026");
  });

  it("sorts a de-duplicated copy and leaves invalid labels last", () => {
    const expiries = ["31-Jul-2026", "not-a-date", "31-Jul-2026", "07-Aug-2026"];
    expect(sortExpiries(expiries)).toEqual(["31-Jul-2026", "07-Aug-2026", "not-a-date"]);
    expect(expiries).toEqual(["31-Jul-2026", "not-a-date", "31-Jul-2026", "07-Aug-2026"]);
  });

  it("returns null when no valid expiry exists", () => {
    expect(latestExpiry(["", "not-a-date"])).toBeNull();
  });
});
