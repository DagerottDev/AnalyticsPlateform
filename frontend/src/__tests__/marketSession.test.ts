import { describe, expect, it } from "vitest";
import { getNseMarketSession } from "@/lib/marketSession";

describe("NSE market session", () => {
  it("opens at 09:15 IST and closes at 15:30 IST", () => {
    expect(getNseMarketSession(new Date("2026-07-31T03:44:00Z")).state).toBe("preopen");
    expect(getNseMarketSession(new Date("2026-07-31T03:45:00Z")).state).toBe("open");
    expect(getNseMarketSession(new Date("2026-07-31T10:00:00Z")).state).toBe("closed");
  });

  it("is closed on a Friday evening and weekends", () => {
    expect(getNseMarketSession(new Date("2026-07-31T18:21:00Z")).state).toBe("closed");
    expect(getNseMarketSession(new Date("2026-08-01T04:00:00Z")).state).toBe("closed");
  });
});
