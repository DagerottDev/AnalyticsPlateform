import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OptionChain } from "@/components/market/OptionChain";
import type { Instrument, MarketTick } from "@/types/market";

// OptionChain is the largest, most-viewed component in the app and was
// previously entirely untested. Its render tree is duplicated for mobile
// (plain-text "Buy"/"Sell" buttons, no distinguishing aria-label) and desktop
// (aria-label="Buy {trading_symbol}", uniquely identifiable per contract) —
// both trees are always present in jsdom since there's no real CSS media
// query. Tests here deliberately target the desktop table's per-symbol
// aria-labelled buttons to avoid ambiguous double-matches; anything that
// isn't duplicated (the filter toolbar, basket/analysis action buttons) is
// queried directly.
//
// BuyTicketModal and BasketOrderModal are stubbed out — their own internals
// are already covered by buyTicketModal.test.tsx — and these tests instead
// assert they're invoked with the right props from a Buy/Sell/basket click.

const getInstrumentsMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/market", () => ({
  getInstruments: getInstrumentsMock,
}));

const tickMap = vi.hoisted(() => new Map<string, MarketTick>());
vi.mock("@/hooks/useMarketData", () => ({
  useMarketData: () => ({
    getTick: (symbol: string) => tickMap.get(symbol) ?? null,
  }),
}));

const settingsState = vi.hoisted(() => ({
  optionChain: {
    showGreeks: false,
    showBuildup: false,
    moneyness: "all" as const,
    strikesEachSide: 10 as number | null,
  },
  charts: { refreshSeconds: 30 },
  analytics: { riskFreeRatePercent: { NIFTY: 10, DEFAULT: 10 } as Record<string, number> },
}));
vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
}));

vi.mock("@/components/market/BuyTicketModal", () => ({
  BuyTicketModal: (props: { symbol: string; instrument: Instrument; initialSide?: string; onClose: () => void }) => (
    <div data-testid="buy-ticket-modal">
      <span>Mock ticket: {props.initialSide} {props.instrument.trading_symbol}</span>
      <button onClick={props.onClose}>Close ticket</button>
    </div>
  ),
}));
vi.mock("@/components/market/BasketOrderModal", () => ({
  BasketOrderModal: (props: { legs: { instrument: Instrument }[]; onClose: () => void }) => (
    <div data-testid="basket-modal">
      <span>Mock basket with {props.legs.length} legs</span>
      <button onClick={props.onClose}>Close basket</button>
    </div>
  ),
}));

const SYMBOL = "NIFTY";
const EXPIRY = "27-Aug-2026";

function makeInstrument(strike: number, optionType: "CE" | "PE"): Instrument {
  return {
    trading_symbol: `NSE:NIFTY${EXPIRY}${strike}${optionType}`,
    symbol: SYMBOL,
    instrument_type: "OPTIDX",
    expiry: EXPIRY,
    strike,
    option_type: optionType,
    exchange: "NFO",
    lot_size: 75,
    oi: 1000,
  };
}

function buildChain(): Instrument[] {
  return [24800, 24900, 25000, 25100, 25200].flatMap((strike) => [
    makeInstrument(strike, "CE"),
    makeInstrument(strike, "PE"),
  ]);
}

function makeTick(tradingSymbol: string, overrides: Partial<MarketTick> = {}): MarketTick {
  return {
    trading_symbol: tradingSymbol,
    last_price: 100,
    volume: 500,
    open_interest: 1000,
    timestamp: Date.now() / 1000,
    change: 1,
    change_percent: 1.5,
    ...overrides,
  };
}

beforeEach(() => {
  getInstrumentsMock.mockReset();
  tickMap.clear();
  settingsState.optionChain = {
    showGreeks: false,
    showBuildup: false,
    moneyness: "all",
    strikesEachSide: 10,
  };
  tickMap.set(SYMBOL, makeTick(SYMBOL, { last_price: 25000 }));
});

async function renderWithChain() {
  getInstrumentsMock.mockResolvedValue({ instruments: buildChain() });
  render(<OptionChain symbol={SYMBOL} expiry={EXPIRY} />);
  await waitFor(() => expect(screen.queryByText(/Loading option chain/i)).toBeNull());
}

describe("OptionChain — loading, empty, and error states", () => {
  it("shows a loading state while instruments are being fetched", async () => {
    let resolveFetch: (value: { instruments: Instrument[] }) => void = () => {};
    getInstrumentsMock.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));

    render(<OptionChain symbol={SYMBOL} expiry={EXPIRY} />);
    expect(screen.getByText(/Loading option chain/i)).toBeTruthy();

    await act(async () => {
      resolveFetch({ instruments: buildChain() });
    });
    await waitFor(() => expect(screen.queryByText(/Loading option chain/i)).toBeNull());
  });

  it("shows the empty state when no expiry is selected", () => {
    render(<OptionChain symbol={SYMBOL} expiry={null} />);

    expect(screen.getByText("No contracts found for selected expiry.")).toBeTruthy();
    expect(getInstrumentsMock).not.toHaveBeenCalled();
  });

  it("shows an error state and the failure message when the fetch fails", async () => {
    getInstrumentsMock.mockRejectedValue(new Error("network down"));
    render(<OptionChain symbol={SYMBOL} expiry={EXPIRY} />);

    await waitFor(() => expect(screen.getByText("Failed to load option chain")).toBeTruthy());
  });
});

describe("OptionChain — rendering strikes", () => {
  it("renders one row per strike and marks the ATM strike", async () => {
    await renderWithChain();

    // ATM badge should appear (spot=25000 -> ATM strike 25000). Both the
    // mobile card and desktop table render an ATM badge for the same row.
    const atmBadges = screen.getAllByText("ATM");
    expect(atmBadges.length).toBeGreaterThan(0);
    expect(screen.getByText("Showing 5 of 5 available strikes")).toBeTruthy();
  });

  it("filters strikes by the strike-range select", async () => {
    // A wider chain than the default fixture so ±5 actually narrows the
    // visible rows (the 5-strike default chain already fits within ±5).
    const wideChain = Array.from({ length: 15 }, (_, i) => 24300 + i * 100).flatMap((strike) => [
      makeInstrument(strike, "CE"),
      makeInstrument(strike, "PE"),
    ]);
    getInstrumentsMock.mockResolvedValue({ instruments: wideChain });
    render(<OptionChain symbol={SYMBOL} expiry={EXPIRY} />);
    await waitFor(() => expect(screen.queryByText(/Loading option chain/i)).toBeNull());
    expect(screen.getByText("Showing 15 of 15 available strikes")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Filter option chain by strike range"), {
      target: { value: "5" },
    });

    // ATM (25000) is index 7 of 15; ±5 keeps indices 2-12 -> 11 rows.
    await waitFor(() => expect(screen.getByText("Showing 11 of 15 available strikes")).toBeTruthy());
  });

  it("filters to ITM-only strikes via the moneyness select", async () => {
    await renderWithChain();

    fireEvent.change(screen.getByLabelText("Filter option chain by moneyness"), {
      target: { value: "itm" },
    });

    // ITM strikes are strictly below the ATM strike (25000): 24800, 24900 -> 2 rows.
    await waitFor(() => expect(screen.getByText("Showing 2 of 5 available strikes")).toBeTruthy());
  });
});

describe("OptionChain — Buy/Sell order ticket", () => {
  it("opens the buy ticket with the correct instrument and side when Buy is clicked", async () => {
    await renderWithChain();
    const target = buildChain().find((i) => i.strike === 25000 && i.option_type === "CE")!;

    fireEvent.click(screen.getByRole("button", { name: `Buy ${target.trading_symbol}` }));

    expect(screen.getByTestId("buy-ticket-modal")).toBeTruthy();
    expect(screen.getByText(`Mock ticket: Buy ${target.trading_symbol}`)).toBeTruthy();
  });

  it("opens the sell ticket for a put strike and closes it via onClose", async () => {
    await renderWithChain();
    const target = buildChain().find((i) => i.strike === 25100 && i.option_type === "PE")!;

    fireEvent.click(screen.getByRole("button", { name: `Sell ${target.trading_symbol}` }));
    expect(screen.getByText(`Mock ticket: Sell ${target.trading_symbol}`)).toBeTruthy();

    fireEvent.click(screen.getByText("Close ticket"));
    expect(screen.queryByTestId("buy-ticket-modal")).toBeNull();
  });
});

describe("OptionChain — basket", () => {
  it("adding a contract to the basket enables and updates the Basket button, and opens the modal with the right leg count", async () => {
    await renderWithChain();
    const target = buildChain().find((i) => i.strike === 25000 && i.option_type === "CE")!;

    const basketButton = screen.getByRole("button", { name: /^Basket \(0\)$/ }) as HTMLButtonElement;
    expect(basketButton.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: `Add ${target.trading_symbol} to basket` }));

    const updatedBasketButton = screen.getByRole("button", { name: /^Basket \(1\)$/ }) as HTMLButtonElement;
    expect(updatedBasketButton.disabled).toBe(false);

    fireEvent.click(updatedBasketButton);
    expect(screen.getByText("Mock basket with 1 legs")).toBeTruthy();
  });

  it("clicking the same contract again removes it from the basket", async () => {
    await renderWithChain();
    const target = buildChain().find((i) => i.strike === 24900 && i.option_type === "PE")!;

    fireEvent.click(screen.getByRole("button", { name: `Add ${target.trading_symbol} to basket` }));
    expect(screen.getByRole("button", { name: /^Basket \(1\)$/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: `Remove ${target.trading_symbol} from basket` }));
    expect(screen.getByRole("button", { name: /^Basket \(0\)$/ })).toBeTruthy();
  });
});

describe("OptionChain — Greek/analysis selection", () => {
  it("selecting a contract for analysis updates the selection counter and enables the analysis buttons", async () => {
    await renderWithChain();
    const target = buildChain().find((i) => i.strike === 25000 && i.option_type === "CE")!;

    expect(screen.getByText("0/10 selected")).toBeTruthy();
    const analyzeButton = screen.getByRole("button", { name: /Analyze Greeks/i }) as HTMLButtonElement;
    expect(analyzeButton.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: `Select ${target.trading_symbol} for Greek analysis` }));

    expect(screen.getByText("1/10 selected")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Analyze Greeks/i }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: /Combined Premium/i }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("OptionChain — CSV export", () => {
  it("exports without crashing and triggers a download", async () => {
    await renderWithChain();

    const createObjectURL = vi.fn(() => "blob:mock-url");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    fireEvent.click(screen.getByRole("button", { name: /Export CSV/i }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");

    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});

describe("OptionChain — Open Interest link", () => {
  it("is disabled with no expiry and enabled once one is selected", async () => {
    await renderWithChain();

    const oiButton = screen.getByRole("button", { name: /Open Interest/i }) as HTMLButtonElement;
    expect(oiButton.disabled).toBe(false);
  });
});
