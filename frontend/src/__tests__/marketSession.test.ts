import { describe, expect, it } from "vitest";
import { getNseMarketSession, isFnoSymbol } from "@/lib/marketSession";

describe("NSE market session", () => {
  it("opens at 09:15 IST and uses the pre-CAS F&O close before 03-Aug-2026", () => {
    expect(getNseMarketSession(new Date("2026-07-31T03:44:00Z")).state).toBe("preopen");
    expect(getNseMarketSession(new Date("2026-07-31T03:45:00Z")).state).toBe("open");
    expect(getNseMarketSession(new Date("2026-07-31T10:00:00Z")).state).toBe("closed");
  });

  it("keeps F&O open through 15:40 after CAS timing while cash closes at 15:30", () => {
    const at1535 = new Date("2026-08-03T10:05:00Z"); // 15:35 IST
    expect(getNseMarketSession(at1535, "fno").state).toBe("open");
    expect(getNseMarketSession(at1535, "cash").state).toBe("closed");
    expect(getNseMarketSession(new Date("2026-08-03T10:10:00Z"), "fno").state).toBe("closed");
  });

  it("does not treat 15:15 IST as the F&O close", () => {
    expect(getNseMarketSession(new Date("2026-08-05T09:45:00Z"), "fno").state).toBe("open");
  });

  it("classifies explicit cash symbols separately from F&O references", () => {
    expect(isFnoSymbol("NFO:NIFTY26AUG22000CE")).toBe(true);
    expect(isFnoSymbol("NSE_FNO:12345")).toBe(true);
    expect(isFnoSymbol("NSE:SBIN-EQ")).toBe(false);
  });

  it("is closed on a Friday evening and weekends", () => {
    expect(getNseMarketSession(new Date("2026-07-31T18:21:00Z")).state).toBe("closed");
    expect(getNseMarketSession(new Date("2026-08-01T04:00:00Z")).state).toBe("closed");
  });
});
