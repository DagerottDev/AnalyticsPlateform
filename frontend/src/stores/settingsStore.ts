import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ChartIndicators } from "@/lib/chartIndicators";
import { createDefaultChartIndicators } from "@/lib/chartIndicators";
import type { MoneynessFilter } from "@/lib/optionChainFilters";
import type { GreekMetric } from "@/lib/strikeGreekAnalysis";
import type { GreekPanelLayout } from "@/lib/greekWorkspaceLayout";

export type ThemeMode = "dark" | "light";
export type SettingsSyncStatus = "local" | "loading" | "saving" | "saved" | "error";
export type ReplayOptionSide = "BOTH" | "CE" | "PE";
export type ReplaySpeed = 1 | 5 | 10 | 100;
export type StrategyPresetName = "Iron Condor" | "Straddle" | "Strangle" | "Butterfly" | "Calendar" | "Diagonal";
export type DefaultAlertMetric = "Price" | "IV" | "Delta" | "Gamma" | "Theta" | "Vega" | "Call GEX" | "Put GEX" | "Net GEX" | "VWAP Breakout";
export type DefaultAlertOperator = ">" | "<" | ">=" | "<=";
export type ChartTimeframe = "1" | "3" | "5" | "10" | "15";
export type ReplayResolution = "1" | "5" | "15";
export type RollingSelectionMode = "smooth" | "raw";
export type PremiumChartSeriesType = "candlestick" | "line";
export type CombinedPremiumGroup = "calls" | "puts" | "both";

export const INDEX_SYMBOLS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX"] as const;
export const DEFAULT_RATE_SYMBOL = "DEFAULT";

export interface UserPreferences {
  schemaVersion: 1;
  appearance: { theme: ThemeMode };
  general: { defaultSymbol: string; watchlist: string[] };
  notifications: { toast: boolean; desktop: boolean };
  charts: { timeframe: ChartTimeframe; historyDays: number; refreshSeconds: 15 | 30 | 60; indicators: ChartIndicators };
  optionChain: { showGreeks: boolean; showBuildup: boolean; moneyness: MoneynessFilter; strikesEachSide: 5 | 10 | 20 | null; defaultGttValidityDays: number; rollingSelectionMode: RollingSelectionMode };
  greekWorkspace: { timeframe: ChartTimeframe; visibleGreeks: GreekMetric[]; panels: Partial<Record<GreekMetric, GreekPanelLayout>>; educationOpen: boolean; syncCharts: boolean };
  combinedPremiumWorkspace: { timeframe: ChartTimeframe; syncCharts: boolean; seriesType: PremiumChartSeriesType; indicators: Record<CombinedPremiumGroup, ChartIndicators> };
  replay: { resolution: ReplayResolution; speedMultiplier: ReplaySpeed; optionSide: ReplayOptionSide; fallbackIvPercent: Record<string, number> };
  analytics: { riskFreeRatePercent: Record<string, number> };
  strategy: { defaultPreset: StrategyPresetName; backtestHoldingDays: number; backtestDaysToExpiry: number };
  alerts: { metric: DefaultAlertMetric; operator: DefaultAlertOperator; cooldownMinutes: number };
}

export interface ServerUserPreferences extends UserPreferences {
  persisted: boolean;
  updatedAt: string | null;
}

const cloneIndicators = (): ChartIndicators => createDefaultChartIndicators();

function premiumIndicators(): ChartIndicators {
  const indicators = cloneIndicators();
  indicators.ema.enabled = true;
  return indicators;
}

export const createDefaultUserPreferences = (): UserPreferences => ({
  schemaVersion: 1,
  appearance: { theme: "dark" },
  general: { defaultSymbol: "NIFTY", watchlist: ["NIFTY", "BANKNIFTY"] },
  notifications: { toast: true, desktop: false },
  charts: { timeframe: "1", historyDays: 7, refreshSeconds: 30, indicators: cloneIndicators() },
  optionChain: { showGreeks: true, showBuildup: true, moneyness: "all", strikesEachSide: 10, defaultGttValidityDays: 30, rollingSelectionMode: "smooth" },
  greekWorkspace: {
    timeframe: "5",
    visibleGreeks: ["delta", "gamma", "theta", "vega", "vanna", "vomma"],
    panels: {},
    educationOpen: false,
    syncCharts: false,
  },
  combinedPremiumWorkspace: {
    timeframe: "5",
    syncCharts: true,
    seriesType: "candlestick",
    indicators: { calls: premiumIndicators(), puts: premiumIndicators(), both: premiumIndicators() },
  },
  replay: {
    resolution: "1",
    speedMultiplier: 1,
    optionSide: "BOTH",
    fallbackIvPercent: { NIFTY: 14, BANKNIFTY: 18, FINNIFTY: 17, MIDCPNIFTY: 20, SENSEX: 15, DEFAULT: 15 },
  },
  analytics: { riskFreeRatePercent: { NIFTY: 10, BANKNIFTY: 10, FINNIFTY: 10, MIDCPNIFTY: 10, SENSEX: 10, DEFAULT: 10 } },
  strategy: { defaultPreset: "Iron Condor", backtestHoldingDays: 5, backtestDaysToExpiry: 30 },
  alerts: { metric: "Price", operator: ">", cooldownMinutes: 15 },
});

function preferencesFromState(state: SettingsState): UserPreferences {
  return {
    schemaVersion: state.schemaVersion,
    appearance: state.appearance,
    general: state.general,
    notifications: state.notifications,
    charts: state.charts,
    optionChain: state.optionChain,
    greekWorkspace: state.greekWorkspace,
    combinedPremiumWorkspace: state.combinedPremiumWorkspace,
    replay: state.replay,
    analytics: state.analytics,
    strategy: state.strategy,
    alerts: state.alerts,
  };
}

interface SettingsState extends UserPreferences {
  /** Compatibility fields retained for established consumers. */
  theme: ThemeMode;
  defaultSymbol: string;
  notifyToast: boolean;
  notifyDesktop: boolean;
  defaultGttValidityDays: number;
  profileOwner: string | null;
  hydratedOwner: string | null;
  syncStatus: SettingsSyncStatus;
  syncError: string | null;
  dirty: boolean;
  revision: number;
  setTheme: (theme: ThemeMode) => void;
  setDefaultSymbol: (symbol: string) => void;
  setNotifyToast: (enabled: boolean) => void;
  setNotifyDesktop: (enabled: boolean) => void;
  setDefaultGttValidityDays: (days: number) => void;
  updatePreferences: (updater: (current: UserPreferences) => UserPreferences) => void;
  applyServerPreferences: (preferences: UserPreferences, owner: string, persisted: boolean) => void;
  prepareForOwner: (owner: string) => void;
  markSyncLoading: () => void;
  markSyncSaving: () => void;
  markSynced: (preferences: UserPreferences, owner: string, revision: number) => void;
  markSyncError: (message: string) => void;
  resetToDefaults: () => void;
}

function stateFor(preferences: UserPreferences, extras: Partial<SettingsState> = {}): Partial<SettingsState> {
  return {
    ...preferences,
    theme: preferences.appearance.theme,
    defaultSymbol: preferences.general.defaultSymbol,
    notifyToast: preferences.notifications.toast,
    notifyDesktop: preferences.notifications.desktop,
    defaultGttValidityDays: preferences.optionChain.defaultGttValidityDays,
    ...extras,
  };
}

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase() || "NIFTY";
}

function migrateLegacy(persistedState: unknown): Partial<SettingsState> {
  const legacy = persistedState as Partial<SettingsState> & { theme?: ThemeMode; defaultSymbol?: string; notifyToast?: boolean; notifyDesktop?: boolean };
  const defaults = createDefaultUserPreferences();
  if (legacy.appearance && legacy.general && legacy.notifications) return {
    ...legacy,
    optionChain: { ...defaults.optionChain, ...legacy.optionChain },
    combinedPremiumWorkspace: {
      ...defaults.combinedPremiumWorkspace,
      ...legacy.combinedPremiumWorkspace,
      indicators: {
        ...defaults.combinedPremiumWorkspace.indicators,
        ...legacy.combinedPremiumWorkspace?.indicators,
      },
    },
  };
  const preferences: UserPreferences = {
    ...defaults,
    appearance: { theme: legacy.theme === "light" ? "light" : defaults.appearance.theme },
    general: { ...defaults.general, defaultSymbol: normalizeSymbol(legacy.defaultSymbol ?? defaults.general.defaultSymbol) },
    notifications: {
      toast: legacy.notifyToast ?? defaults.notifications.toast,
      desktop: legacy.notifyDesktop ?? defaults.notifications.desktop,
    },
  };
  return stateFor(preferences, { profileOwner: null, hydratedOwner: null, syncStatus: "local", syncError: null, dirty: false, revision: 0 });
}

const defaults = createDefaultUserPreferences();

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...(stateFor(defaults, { profileOwner: null, hydratedOwner: null, syncStatus: "local", syncError: null, dirty: false, revision: 0 }) as SettingsState),
      setTheme: (theme) => get().updatePreferences((current) => ({ ...current, appearance: { theme } })),
      setDefaultSymbol: (symbol) => get().updatePreferences((current) => ({ ...current, general: { ...current.general, defaultSymbol: normalizeSymbol(symbol) } })),
      setNotifyToast: (enabled) => get().updatePreferences((current) => ({ ...current, notifications: { ...current.notifications, toast: enabled } })),
      setNotifyDesktop: (enabled) => get().updatePreferences((current) => ({ ...current, notifications: { ...current.notifications, desktop: enabled } })),
      setDefaultGttValidityDays: (days) => get().updatePreferences((current) => ({ ...current, optionChain: { ...current.optionChain, defaultGttValidityDays: Math.max(1, Math.trunc(days) || 30) } })),
      updatePreferences: (updater) => set((current) => {
        const next = updater(preferencesFromState(current));
        return stateFor(next, { dirty: true, syncStatus: current.hydratedOwner ? "local" : current.syncStatus, syncError: null, revision: current.revision + 1 });
      }),
      applyServerPreferences: (preferences, owner, persisted) => set(stateFor(preferences, {
        profileOwner: owner,
        hydratedOwner: owner,
        syncStatus: persisted ? "saved" : "local",
        syncError: null,
        dirty: false,
      })),
      prepareForOwner: (owner) => set((current) => {
        if (current.profileOwner && current.profileOwner !== owner) {
          return stateFor(createDefaultUserPreferences(), {
            profileOwner: owner,
            hydratedOwner: null,
            syncStatus: "local",
            syncError: null,
            dirty: true,
            revision: current.revision + 1,
          });
        }
        return { profileOwner: owner };
      }),
      markSyncLoading: () => set({ syncStatus: "loading", syncError: null }),
      markSyncSaving: () => set({ syncStatus: "saving", syncError: null }),
      markSynced: (preferences, owner, revision) => set((current) => stateFor(preferences, {
        profileOwner: owner,
        hydratedOwner: owner,
        syncStatus: "saved",
        syncError: null,
        dirty: current.revision !== revision,
      })),
      markSyncError: (message) => set({ syncStatus: "error", syncError: message }),
      resetToDefaults: () => get().updatePreferences(() => createDefaultUserPreferences()),
    }),
    {
      name: "settings-storage",
      version: 2,
      storage: createJSONStorage(() => localStorage),
      migrate: (persistedState) => migrateLegacy(persistedState),
      partialize: (state) => ({
        ...preferencesFromState(state),
        profileOwner: state.profileOwner,
        hydratedOwner: state.hydratedOwner,
        revision: state.revision,
      }),
    }
  )
);

export function riskFreeRateForSymbol(symbol: string): number {
  const rates = useSettingsStore.getState().analytics.riskFreeRatePercent;
  return (rates[symbol.trim().toUpperCase()] ?? rates[DEFAULT_RATE_SYMBOL] ?? 10) / 100;
}

export function currentUserPreferences(): UserPreferences {
  return preferencesFromState(useSettingsStore.getState());
}
