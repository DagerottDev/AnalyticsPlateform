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
  expiry: string;
  strike: number | null;
  optionSide: "BOTH" | "CE" | "PE";
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
  setExpiry: (expiry: string) => void;
  setStrike: (strike: number | null) => void;
  setOptionSide: (side: "BOTH" | "CE" | "PE") => void;
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
  expiry: "",
  strike: null,
  optionSide: "BOTH",
  priceCoverage: null,

  setIsActive: (active) => set({ isActive: active }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setSpeedMultiplier: (speed) => set({ speedMultiplier: speed }),
  setProgressPercentage: (percent) => set({ progressPercentage: percent }),
  setCurrentTicks: (ticks) => set({ currentTicks: ticks }),
  setSymbol: (sym) => set({ symbol: sym }),
  setSessionDate: (date) => set({ sessionDate: date }),
  setExpiry: (expiry) => set({ expiry }),
  setStrike: (strike) => set({ strike }),
  setOptionSide: (optionSide) => set({ optionSide }),
  setPriceCoverage: (coverage) => set({ priceCoverage: coverage }),
  reset: () => set({
    isActive: false,
    isPlaying: false,
    speedMultiplier: 1,
    progressPercentage: 0,
    currentTicks: {},
    symbol: "",
    sessionDate: "",
    expiry: "",
    strike: null,
    optionSide: "BOTH",
    priceCoverage: null,
  }),
}));
