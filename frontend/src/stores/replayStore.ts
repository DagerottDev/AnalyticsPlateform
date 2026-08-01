import { create } from "zustand";
import { TickData } from "@/types/market";

export interface ReplayTickMap {
  [symbol: string]: TickData;
}

export interface ReplayPriceCoverage {
  attempted: number;
  matched: number;
}

interface ReplayState {
  isActive: boolean;
  isPlaying: boolean;
  speedMultiplier: number;
  progressPercentage: number;
  currentTicks: ReplayTickMap;
  symbol: string;
  sessionDate: string;
  /** How many near-the-money contracts ended up with real broker prices vs.
   * modeled ones for this session — null until a session has been built. */
  priceCoverage: ReplayPriceCoverage | null;

  setIsActive: (active: boolean) => void;
  setIsPlaying: (playing: boolean) => void;
  setSpeedMultiplier: (speed: number) => void;
  setProgressPercentage: (percent: number) => void;
  setCurrentTicks: (ticks: ReplayTickMap) => void;
  setSymbol: (sym: string) => void;
  setSessionDate: (date: string) => void;
  setPriceCoverage: (coverage: ReplayPriceCoverage | null) => void;
  reset: () => void;
}

export const useReplayStore = create<ReplayState>((set) => ({
  isActive: false,
  isPlaying: false,
  speedMultiplier: 1,
  progressPercentage: 0,
  currentTicks: {},
  symbol: "",
  sessionDate: "",
  priceCoverage: null,

  setIsActive: (active) => set({ isActive: active }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setSpeedMultiplier: (speed) => set({ speedMultiplier: speed }),
  setProgressPercentage: (percent) => set({ progressPercentage: percent }),
  setCurrentTicks: (ticks) => set({ currentTicks: ticks }),
  setSymbol: (sym) => set({ symbol: sym }),
  setSessionDate: (date) => set({ sessionDate: date }),
  setPriceCoverage: (coverage) => set({ priceCoverage: coverage }),
  reset: () => set({
    isActive: false,
    isPlaying: false,
    speedMultiplier: 1,
    progressPercentage: 0,
    currentTicks: {},
    symbol: "",
    sessionDate: "",
    priceCoverage: null,
  }),
}));
