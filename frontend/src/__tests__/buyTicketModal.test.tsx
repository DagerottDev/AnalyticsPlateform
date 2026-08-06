import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BuyTicketModal } from "@/components/market/BuyTicketModal";
import type { Instrument, MarketTick } from "@/types/market";

// BuyTicketModal is the order-placement UI for both paper and live trading —
// previously entirely untested. This covers the highest-stakes surfaces:
// quantity/side wiring into the submitted order, lot-size validation, GTT
// trigger-direction validation, and the IST expiry default fixed earlier
// this session (see marketSession.test.ts for the underlying pure-function
// coverage — this is the integration-level check that the picker actually
// uses it).

const authState = vi.hoisted(() => ({
  tradingMode: "paper" as "paper" | "live",
  canTrade: false,
  sessionLive: false,
}));
const executePaperOrder = vi.hoisted(() => vi.fn());
const paperGttAdd = vi.hoisted(() => vi.fn());
const createGttOrderMock = vi.hoisted(() => vi.fn());
const placeOrderMock = vi.hoisted(() => vi.fn());
const getMarginRequirementMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => authState }));
vi.mock("@/stores/positionStore", () => ({
  usePositionStore: (selector: (state: { executePaperOrder: typeof executePaperOrder }) => unknown) =>
    selector({ executePaperOrder }),
}));
vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: (selector: (state: { defaultGttValidityDays: number }) => unknown) =>
    selector({ defaultGttValidityDays: 7 }),
}));
vi.mock("@/stores/paperGttStore", () => ({
  usePaperGttStore: (selector: (state: { add: typeof paperGttAdd }) => unknown) =>
    selector({ add: paperGttAdd }),
}));
vi.mock("@/lib/orders", () => ({
  createGttOrder: createGttOrderMock,
  placeOrder: placeOrderMock,
}));
vi.mock("@/lib/market", () => ({
  getMarginRequirement: getMarginRequirementMock,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const instrument: Instrument = {
  trading_symbol: "NSE:NIFTY26AUG25000CE",
  symbol: "NIFTY",
  instrument_type: "OPTIDX",
  expiry: "27-Aug-2026",
  strike: 25000,
  option_type: "CE",
  exchange: "NFO",
  lot_size: 75,
};

function makeTick(overrides: Partial<MarketTick> = {}): MarketTick {
  return {
    trading_symbol: instrument.trading_symbol,
    last_price: 150,
    volume: 1000,
    open_interest: 500,
    timestamp: Date.now() / 1000,
    change: 5,
    change_percent: 3.4,
    ...overrides,
  };
}

describe("BuyTicketModal — paper order submission", () => {
  beforeEach(() => {
    authState.tradingMode = "paper";
    authState.canTrade = false;
    authState.sessionLive = false;
    executePaperOrder.mockClear();
    paperGttAdd.mockClear();
  });

  it("defaults quantity to the instrument's lot size", () => {
    render(<BuyTicketModal symbol="NIFTY" instrument={instrument} tick={makeTick()} onClose={vi.fn()} />);

    const quantityInput = screen.getByLabelText(/Quantity/i) as HTMLInputElement;
    expect(quantityInput.value).toBe("75");
  });

  it("submits a paper MARKET buy order with the entered quantity and side", async () => {
    render(
      <BuyTicketModal
        symbol="NIFTY"
        instrument={instrument}
        tick={makeTick({ last_price: 150 })}
        onClose={vi.fn()}
        initialSide="Buy"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Place paper buy/i }));

    await waitFor(() => expect(executePaperOrder).toHaveBeenCalledTimes(1));
    const call = executePaperOrder.mock.calls[0][0];
    expect(call.legs[0].action).toBe("Buy");
    expect(call.legs[0].quantity).toBe(75);
    expect(call.fills[0].price).toBe(150);
  });

  it("submits a Sell order when the side toggle is switched", async () => {
    render(
      <BuyTicketModal
        symbol="NIFTY"
        instrument={instrument}
        tick={makeTick({ last_price: 150 })}
        onClose={vi.fn()}
        initialSide="Buy"
      />
    );

    fireEvent.change(screen.getByLabelText("Side"), { target: { value: "Sell" } });
    fireEvent.click(screen.getByRole("button", { name: /Place paper sell/i }));

    await waitFor(() => expect(executePaperOrder).toHaveBeenCalledTimes(1));
    expect(executePaperOrder.mock.calls[0][0].legs[0].action).toBe("Sell");
  });

  it("disables submission when the quantity is not a multiple of the lot size", () => {
    render(<BuyTicketModal symbol="NIFTY" instrument={instrument} tick={makeTick()} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Quantity/i), { target: { value: "10" } });

    const button = screen.getByRole("button", { name: /Place paper buy/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/multiple of the lot size/i)).toBeTruthy();
  });

  it("disables submission when no live price is available", () => {
    render(
      <BuyTicketModal
        symbol="NIFTY"
        instrument={instrument}
        tick={makeTick({ last_price: 0 })}
        onClose={vi.fn()}
      />
    );

    const button = screen.getByRole("button", { name: /Place paper buy/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});

describe("BuyTicketModal — GTT trigger-direction validation", () => {
  beforeEach(() => {
    authState.tradingMode = "paper";
    executePaperOrder.mockClear();
    paperGttAdd.mockClear();
  });

  function openGttForm(side: "Buy" | "Sell" = "Buy") {
    render(
      <BuyTicketModal
        symbol="NIFTY"
        instrument={instrument}
        tick={makeTick({ last_price: 150 })}
        onClose={vi.fn()}
        initialSide={side}
      />
    );
    fireEvent.change(screen.getByLabelText("Order type"), { target: { value: "GTT" } });
  }

  it("a Buy GTT requires the trigger price to be above the current LTP", () => {
    openGttForm("Buy");
    const submit = () =>
      screen.getByRole("button", { name: /Place paper buy/i }) as HTMLButtonElement;

    fireEvent.change(screen.getByLabelText(/Trigger price/i), { target: { value: "100" } }); // below LTP
    expect(submit().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/Trigger price/i), { target: { value: "200" } }); // above LTP
    expect(submit().disabled).toBe(false);
  });

  it("a Sell GTT requires the trigger price to be below the current LTP", () => {
    openGttForm("Sell");
    const submit = () =>
      screen.getByRole("button", { name: /Place paper sell/i }) as HTMLButtonElement;

    fireEvent.change(screen.getByLabelText(/Trigger price/i), { target: { value: "200" } }); // above LTP
    expect(submit().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/Trigger price/i), { target: { value: "100" } }); // below LTP
    expect(submit().disabled).toBe(false);
  });

  it("schedules a paper GTT with the entered trigger price on submit", async () => {
    openGttForm("Buy");
    fireEvent.change(screen.getByLabelText(/Trigger price/i), { target: { value: "200" } });

    fireEvent.click(screen.getByRole("button", { name: /Place paper buy/i }));

    await waitFor(() => expect(paperGttAdd).toHaveBeenCalledTimes(1));
    expect(paperGttAdd.mock.calls[0][0].triggerPrice).toBe(200);
  });

  it("defaults the GTT expiry field to a valid, non-empty IST datetime-local value", () => {
    openGttForm("Buy");

    const expiryInput = screen.getByLabelText(/GTT expiry/i) as HTMLInputElement;
    // "YYYY-MM-DDTHH:mm" — must be populated (not empty) and well-formed;
    // the underlying IST-correctness of this value is unit-tested directly
    // in marketSession.test.ts (formatIstDatetimeLocal).
    expect(expiryInput.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});

describe("BuyTicketModal — live order review gating", () => {
  beforeEach(() => {
    authState.tradingMode = "live";
    authState.canTrade = true;
    authState.sessionLive = true;
    createGttOrderMock.mockReset();
    placeOrderMock.mockReset();
    getMarginRequirementMock.mockResolvedValue({ total_margin: 1000 });
  });

  it("requires acknowledgement before the confirm button is enabled", () => {
    render(
      <BuyTicketModal
        symbol="NIFTY"
        instrument={instrument}
        tick={makeTick({ last_price: 150 })}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Review live buy/i }));

    const confirm = () =>
      screen.getByRole("button", { name: /Place Buy order/i }) as HTMLButtonElement;
    expect(confirm().disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(confirm().disabled).toBe(false);
  });

  it("submits the live order with the reviewed quantity and side once confirmed", async () => {
    placeOrderMock.mockResolvedValue({ id: "order-1", message: "Order placed" });
    render(
      <BuyTicketModal
        symbol="NIFTY"
        instrument={instrument}
        tick={makeTick({ last_price: 150 })}
        onClose={vi.fn()}
        initialSide="Buy"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Review live buy/i }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Place Buy order/i }));

    await waitFor(() => expect(placeOrderMock).toHaveBeenCalledTimes(1));
    const submitted = placeOrderMock.mock.calls[0][0];
    expect(submitted.symbol).toBe(instrument.trading_symbol);
    expect(submitted.side).toBe("Buy");
    expect(submitted.quantity).toBe(75);
  });
});
