/**
 * Regression tests for the useMarketData subscribe/unsubscribe bug: a fresh
 * inline array literal passed as `symbols` on every render (the exact
 * pattern several pages use, e.g. `useMarketData([...tradingSymbols, symbol])`
 * without memoizing) used to cause the effect to fully unsubscribe and never
 * resubscribe, silently killing live ticks after the first render churn.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMarketData } from "@/hooks/useMarketData";
import type { MarketTick } from "@/types/market";

const subscribeMany = vi.fn();
const unsubscribeMany = vi.fn();

// Hoisted so useAuth() returns the SAME object reference on every call, like
// the real Zustand-store-backed useAuth does — a fresh object literal per
// call would make the effect's `user` dependency look "changed" every
// render for reasons unrelated to what this test is verifying.
const stableUser = { client_id: "TEST_CLIENT" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: stableUser }),
}));

vi.mock("@/stores/replayStore", () => ({
  useReplayStore: (selector: (state: { isActive: boolean; currentTicks: Record<string, unknown> }) => unknown) =>
    selector({ isActive: false, currentTicks: {} }),
}));

vi.mock("@/lib/market", () => ({
  getMarketQuotes: vi.fn().mockResolvedValue({ quotes: [] }),
}));

vi.mock("@/lib/websocket", () => ({
  getWebSocket: () => ({ subscribeMany, unsubscribeMany }),
}));

describe("useMarketData", () => {
  beforeEach(() => {
    subscribeMany.mockClear();
    unsubscribeMany.mockClear();
  });

  it("does not re-subscribe or unsubscribe when re-rendered with a new-but-equal symbols array", async () => {
    const { rerender } = renderHook(({ symbols }: { symbols: string[] }) => useMarketData(symbols), {
      initialProps: { symbols: ["NIFTY", "BANKNIFTY"] },
    });

    expect(subscribeMany).toHaveBeenCalledTimes(1);
    expect(subscribeMany).toHaveBeenCalledWith(["NIFTY", "BANKNIFTY"], expect.any(Function));

    // Same content, brand-new array reference — exactly the
    // `useMarketData([...tradingSymbols, symbol])` call-site pattern that
    // triggered the bug.
    rerender({ symbols: ["NIFTY", "BANKNIFTY"] });

    expect(subscribeMany).toHaveBeenCalledTimes(1);
    expect(unsubscribeMany).not.toHaveBeenCalled();

    await act(async () => {}); // flush the REST quote-seed promise
  });

  it("keeps delivering ticks to the same handler across a new-but-equal symbols array", async () => {
    let capturedHandler: ((tick: MarketTick) => void) | undefined;
    subscribeMany.mockImplementation((_symbols: string[], handler: (tick: MarketTick) => void) => {
      capturedHandler = handler;
    });

    const { result, rerender } = renderHook(({ symbols }: { symbols: string[] }) => useMarketData(symbols), {
      initialProps: { symbols: ["NIFTY"] },
    });

    rerender({ symbols: ["NIFTY"] }); // new reference, same content

    act(() => {
      capturedHandler?.({
        trading_symbol: "NIFTY",
        last_price: 100,
        volume: 0,
        open_interest: 0,
        timestamp: Date.now(),
        change: 0,
        change_percent: 0,
      });
    });

    expect(result.current.getTick("NIFTY")?.last_price).toBe(100);

    await act(async () => {}); // flush the REST quote-seed promise
  });

  it("unsubscribes only the symbol actually removed from the set", async () => {
    const { rerender } = renderHook(({ symbols }: { symbols: string[] }) => useMarketData(symbols), {
      initialProps: { symbols: ["NIFTY", "BANKNIFTY"] },
    });

    rerender({ symbols: ["NIFTY"] }); // BANKNIFTY genuinely dropped

    expect(unsubscribeMany).toHaveBeenCalledWith(["BANKNIFTY"], expect.any(Function));

    await act(async () => {}); // flush the REST quote-seed promise
  });
});
