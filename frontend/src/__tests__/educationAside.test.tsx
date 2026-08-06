import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EducationAside } from "@/components/ui/EducationAside";

// EducationAside is the shared shell behind DealerFlowEducationAside,
// GreekEducationAside, IVScreenerEducationAside, and
// RelativeValueEducationAside (each now a thin wrapper supplying only its
// own copy — see their own test files for the per-workspace content checks).
// This covers the shared structure itself: sections, the close button, and
// the "Learn more" links list including its zero/one/many-link edge cases.
describe("EducationAside", () => {
  it("renders the title, intro, and every section", () => {
    render(
      <EducationAside
        ariaLabel="Test education"
        closeLabel="Hide test education"
        title="How to use this"
        intro="An intro sentence."
        sections={[{ title: "Step 1", body: "Do the first thing." }, { title: "Step 2", body: "Do the second thing." }]}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole("complementary", { name: "Test education" })).toBeTruthy();
    expect(screen.getByText("How to use this")).toBeTruthy();
    expect(screen.getByText("An intro sentence.")).toBeTruthy();
    expect(screen.getByText("Step 1")).toBeTruthy();
    expect(screen.getByText("Do the second thing.")).toBeTruthy();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <EducationAside ariaLabel="Test education" closeLabel="Hide test education" title="T" intro="I" sections={[]} onClose={onClose} />
    );

    fireEvent.click(screen.getByRole("button", { name: "Hide test education" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("omits the Learn more block entirely when no links are supplied", () => {
    render(
      <EducationAside ariaLabel="Test education" closeLabel="Hide test education" title="T" intro="I" sections={[]} onClose={vi.fn()} />
    );

    expect(screen.queryByText("Learn more")).toBeNull();
  });

  it("renders every link with the correct href and target, with spacing only between links", () => {
    render(
      <EducationAside
        ariaLabel="Test education"
        closeLabel="Hide test education"
        title="T"
        intro="I"
        sections={[]}
        links={[
          { label: "First reference", href: "https://example.com/first" },
          { label: "Second reference", href: "https://example.com/second" },
        ]}
        onClose={vi.fn()}
      />
    );

    const learnMore = screen.getByText("Learn more").closest("div")!;
    const links = within(learnMore).getAllByRole("link") as HTMLAnchorElement[];
    expect(links.map((link) => link.textContent?.trim())).toEqual(["First reference", "Second reference"]);
    expect(links[0].href).toBe("https://example.com/first");
    expect(links[0].target).toBe("_blank");
    expect(links[0].rel).toBe("noreferrer");
    // Only the non-last link carries the bottom-margin spacing class.
    expect(links[0].className).toContain("mb-2");
    expect(links[1].className).not.toContain("mb-2");
  });
});
