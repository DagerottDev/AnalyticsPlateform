import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DealerFlowEducationAside } from "@/components/dealer-flow/DealerFlowEducationAside";

describe("DealerFlowEducationAside", () => {
  it("renders every learning section and both external reference links", () => {
    render(<DealerFlowEducationAside onClose={vi.fn()} />);

    expect(screen.getByRole("complementary", { name: "Dealer Flow education" })).toBeTruthy();
    expect(screen.getByText("1. Choose an underlying and expiry")).toBeTruthy();
    expect(screen.getByText("4. Compare higher-order exposure")).toBeTruthy();

    const greeksLink = screen.getByRole("link", { name: /Understanding option Greeks/i }) as HTMLAnchorElement;
    expect(greeksLink.href).toBe("https://www.optionseducation.org/advancedconcepts/understanding-options-greeks");
    expect(greeksLink.target).toBe("_blank");

    const volatilityLink = screen.getByRole("link", { name: /Volatility and the Greeks/i }) as HTMLAnchorElement;
    expect(volatilityLink.href).toBe("https://www.optionseducation.org/advancedconcepts/volatility-the-greeks");
  });

  it("calls onClose when the hide button is clicked", () => {
    const onClose = vi.fn();
    render(<DealerFlowEducationAside onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Hide Dealer Flow education" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
