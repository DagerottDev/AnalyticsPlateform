import { beforeEach, describe, expect, it } from "vitest";
import { loadGreekWorkspaceLayout, saveGreekWorkspaceLayout } from "@/lib/greekWorkspaceLayout";

describe("Greek workspace layout", () => {
  beforeEach(() => {
    const entries = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => entries.get(key) ?? null,
        setItem: (key: string, value: string) => entries.set(key, value),
        removeItem: (key: string) => entries.delete(key),
        clear: () => entries.clear(),
        key: (index: number) => Array.from(entries.keys())[index] ?? null,
        get length() { return entries.size; },
      } satisfies Storage,
    });
  });

  it("persists reusable panel choices without any selected contracts", () => {
    saveGreekWorkspaceLayout({
      version: 1,
      visibleGreeks: ["delta", "vega", "vanna"],
      panels: { vega: { overlay: "ema", period: 50, multiplier: 2 } },
      educationOpen: false,
    });

    expect(loadGreekWorkspaceLayout()).toEqual({
      version: 1,
      visibleGreeks: ["delta", "vega", "vanna"],
      panels: { vega: { overlay: "ema", period: 50, multiplier: 2 } },
      educationOpen: false,
    });
  });

  it("ignores malformed persisted layout data", () => {
    window.localStorage.setItem("greek-workspace-layout-v1", JSON.stringify({ version: 1, visibleGreeks: ["not-a-greek"] }));
    expect(loadGreekWorkspaceLayout()).toBeNull();
  });
});
