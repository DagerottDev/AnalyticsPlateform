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

const { subscribeMany, unsubscribeMany, updateAuthToken, getWebSocket } = vi.hoisted(() => {
  const subscribeMany = vi.fn();
  const unsubscribeMany = vi.fn();
  const updateAuthToken = vi.fn();
  const getWebSocket = vi.fn(() => ({ subscribeMany, unsubscribeMany, updateAuthToken }));
  return { subscribeMany, unsubscribeMany, updateAuthToken, getWebSocket };
});

// Hoisted so useAuth() returns the SAME object reference on every call, like
// the real Zustand-store-backed useAuth does — a fresh object literal per
// call would make the effect's `user` dependency look "changed" every
// render for reasons unrelated to what this test is verifying.
const stableUser = { client_id: "TEST_CLIENT" };
const authState: { user: typeof stableUser | null; token: string | null } = {
  user: stableUser,
  token: "test-token",
};
const replayState = { isActive: false, currentTicks: {} as Record<string, unknown> };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => authState,
}));

vi.mock("@/stores/replayStore", () => ({
  useReplayStore: (selector: (state: { isActive: boolean; currentTicks: Record<string, unknown> }) => unknown) =>
    selector(replayState),
}));

vi.mock("@/hooks/useNseMarketSession", () => ({
  useNseMarketSession: () => ({ state: "open", label: "Market open", detail: "test session" }),
}));

vi.mock("@/lib/market", () => ({
  getMarketQuotes: vi.fn().mockResolvedValue({ quotes: [] }),
}));

vi.mock("@/lib/websocket", () => ({
  getWebSocket,
}));

describe("useMarketData", () => {
  beforeEach(() => {
    subscribeMany.mockClear();
    unsubscribeMany.mockClear();
    updateAuthToken.mockClear();
    getWebSocket.mockClear();
    authState.user = stableUser;
    authState.token = "test-token";
    replayState.isActive = false;
    replayState.currentTicks = {};
  });

  it("does not start a market transport before authentication", () => {
    authState.user = null;
    authState.token = null;

    renderHook(() => useMarketData(["NIFTY"]));

    expect(getWebSocket).not.toHaveBeenCalled();
    expect(subscribeMany).not.toHaveBeenCalled();
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

  it("unsubscribes all active symbols when unmounted", async () => {
    const { unmount } = renderHook(() => useMarketData(["NIFTY", "BANKNIFTY"]));

    unmount();

    expect(unsubscribeMany).toHaveBeenCalledWith(["NIFTY", "BANKNIFTY"], expect.any(Function));
    await act(async () => {});
  });

  it("cleans up live subscriptions while replay is active, then restores them", async () => {
    const { rerender } = renderHook(() => useMarketData(["NIFTY"]));

    replayState.isActive = true;
    rerender();
    expect(unsubscribeMany).toHaveBeenCalledWith(["NIFTY"], expect.any(Function));

    replayState.isActive = false;
    rerender();
    expect(subscribeMany).toHaveBeenLastCalledWith(["NIFTY"], expect.any(Function));
    await act(async () => {});
  });

  it("cleans up live subscriptions after logout and supports a clean remount", async () => {
    const first = renderHook(() => useMarketData(["NIFTY"]));

    authState.user = null;
    authState.token = null;
    first.rerender();
    expect(unsubscribeMany).toHaveBeenCalledWith(["NIFTY"], expect.any(Function));

    first.unmount();
    authState.user = stableUser;
    renderHook(() => useMarketData(["NIFTY"]));
    expect(subscribeMany).toHaveBeenLastCalledWith(["NIFTY"], expect.any(Function));
    await act(async () => {});
  });
});
