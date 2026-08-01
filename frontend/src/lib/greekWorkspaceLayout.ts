import type { GreekMetric } from "@/lib/strikeGreekAnalysis";
import type { GreekOverlay } from "@/components/charts/GreekLineChart";

const STORAGE_KEY = "greek-workspace-layout-v1";

export interface GreekPanelLayout {
  overlay: GreekOverlay;
  period: number;
  multiplier: number;
}

export interface GreekWorkspaceLayout {
  version: 1;
  visibleGreeks: GreekMetric[];
  panels: Partial<Record<GreekMetric, GreekPanelLayout>>;
  educationOpen: boolean;
}

export const DEFAULT_GREEK_PANEL_LAYOUT: GreekPanelLayout = {
  overlay: "none",
  period: 20,
  multiplier: 2,
};

function isGreekMetric(value: unknown): value is GreekMetric {
  return typeof value === "string" && [
    "delta", "gamma", "theta", "vega", "rho", "vanna", "vomma", "charm",
    "speed", "color", "zomma", "ultima",
  ].includes(value);
}

function isPanelLayout(value: unknown): value is GreekPanelLayout {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GreekPanelLayout>;
  return ["none", "sma", "ema", "bbands", "supertrend"].includes(candidate.overlay ?? "")
    && typeof candidate.period === "number"
    && Number.isFinite(candidate.period)
    && typeof candidate.multiplier === "number"
    && Number.isFinite(candidate.multiplier);
}

/** Reads a deliberately small, versioned local layout preset. Invalid or old
 * data is ignored so it can never prevent the analysis workspace from opening. */
export function loadGreekWorkspaceLayout(): GreekWorkspaceLayout | null {
  if (typeof window === "undefined") return null;
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!raw || typeof raw !== "object") return null;
    const candidate = raw as Partial<GreekWorkspaceLayout>;
    if (candidate.version !== 1 || !Array.isArray(candidate.visibleGreeks) || !candidate.visibleGreeks.every(isGreekMetric) || !candidate.panels || typeof candidate.panels !== "object" || typeof candidate.educationOpen !== "boolean") return null;

    const panels = Object.fromEntries(
      Object.entries(candidate.panels).flatMap(([metric, layout]) => (
        isGreekMetric(metric) && isPanelLayout(layout) ? [[metric, layout]] : []
      ))
    ) as Partial<Record<GreekMetric, GreekPanelLayout>>;
    return { version: 1, visibleGreeks: candidate.visibleGreeks, panels, educationOpen: candidate.educationOpen };
  } catch {
    return null;
  }
}

export function saveGreekWorkspaceLayout(layout: GreekWorkspaceLayout): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
}
