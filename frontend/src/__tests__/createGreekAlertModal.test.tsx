import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreateGreekAlertModal } from "@/components/greek-workspace/CreateGreekAlertModal";
import type { Instrument } from "@/types/market";

const addAlertMock = vi.hoisted(() => vi.fn());
vi.mock("@/stores/alertStore", () => ({
  useAlertStore: () => ({ addAlert: addAlertMock }),
}));
vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: (selector: (state: { alerts: { cooldownMinutes: number } }) => unknown) =>
    selector({ alerts: { cooldownMinutes: 15 } }),
}));

const instruments: Instrument[] = [
  {
    trading_symbol: "NSE:NIFTY27AUG202625000CE",
    symbol: "NIFTY",
    instrument_type: "OPTIDX",
    expiry: "27-Aug-2026",
    strike: 25000,
    option_type: "CE",
    exchange: "NFO",
  },
  {
    trading_symbol: "NSE:NIFTY27AUG202625100CE",
    symbol: "NIFTY",
    instrument_type: "OPTIDX",
    expiry: "27-Aug-2026",
    strike: 25100,
    option_type: "CE",
    exchange: "NFO",
  },
];

describe("CreateGreekAlertModal", () => {
  beforeEach(() => {
    addAlertMock.mockReset();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <CreateGreekAlertModal isOpen={false} onClose={vi.fn()} instruments={instruments} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("preselects the metric passed from the requesting chart card and defaults the cooldown from settings", () => {
    render(
      <CreateGreekAlertModal isOpen onClose={vi.fn()} instruments={instruments} initialMetric="vega" />
    );

    expect((screen.getByLabelText("Greek") as HTMLSelectElement).value).toBe("vega");
    expect((screen.getByLabelText("Alert cooldown") as HTMLInputElement).value).toBe("15");
  });

  it("disables Create alert until a threshold is entered", () => {
    render(<CreateGreekAlertModal isOpen onClose={vi.fn()} instruments={instruments} />);

    const createButton = screen.getByRole("button", { name: /^Create alert$/ }) as HTMLButtonElement;
    expect(createButton.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Alert threshold"), { target: { value: "0.5" } });
    expect(createButton.disabled).toBe(false);
  });

  it("creates an alert for the selected contract, metric, operator, and threshold", async () => {
    addAlertMock.mockResolvedValue(undefined);
    render(<CreateGreekAlertModal isOpen onClose={vi.fn()} instruments={instruments} initialMetric="delta" />);

    fireEvent.change(screen.getByLabelText("Alert operator"), { target: { value: "<" } });
    fireEvent.change(screen.getByLabelText("Alert threshold"), { target: { value: "0.35" } });
    fireEvent.click(screen.getByRole("button", { name: /^Create alert$/ }));

    await waitFor(() => expect(addAlertMock).toHaveBeenCalledTimes(1));
    expect(addAlertMock).toHaveBeenCalledWith({
      instrument: instruments[0],
      metric: "Delta",
      operator: "<",
      threshold: 0.35,
      cooldownMinutes: 15,
    });
    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/Delta alert saved/);
  });

  it("shows an error and keeps the threshold when the store rejects", async () => {
    addAlertMock.mockRejectedValue(new Error("network error"));
    render(<CreateGreekAlertModal isOpen onClose={vi.fn()} instruments={instruments} />);

    fireEvent.change(screen.getByLabelText("Alert threshold"), { target: { value: "1.2" } });
    fireEvent.click(screen.getByRole("button", { name: /^Create alert$/ }));

    await waitFor(() => expect(addAlertMock).toHaveBeenCalledTimes(1));
    expect((screen.getByLabelText("Alert threshold") as HTMLInputElement).value).toBe("1.2");
  });

  it("calls onClose from both the header close button and the Cancel button", () => {
    const onClose = vi.fn();
    render(<CreateGreekAlertModal isOpen onClose={onClose} instruments={instruments} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
