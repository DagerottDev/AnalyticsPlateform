import { create } from "zustand";
import { TickData } from "@/types/market";

export interface ReplayTickMap {
  [symbol: string]: TickData;
}

interface ReplayState {
  isActive: boolean;
  isPlaying: boolean;
  speedMultiplier: number;
  progressPercentage: number;
  currentTicks: ReplayTickMap;
  symbol: string;
  
  setIsActive: (active: boolean) => void;
  setIsPlaying: (playing: boolean) => void;
  setSpeedMultiplier: (speed: number) => void;
  setProgressPercentage: (percent: number) => void;
  setCurrentTicks: (ticks: ReplayTickMap) => void;
  setSymbol: (sym: string) => void;
  reset: () => void;
}

export const useReplayStore = create<ReplayState>((set) => ({
  isActive: false,
  isPlaying: false,
  speedMultiplier: 1,
  progressPercentage: 0,
  currentTicks: {},
  symbol: "",
  
  setIsActive: (active) => set({ isActive: active }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setSpeedMultiplier: (speed) => set({ speedMultiplier: speed }),
  setProgressPercentage: (percent) => set({ progressPercentage: percent }),
  setCurrentTicks: (ticks) => set({ currentTicks: ticks }),
  setSymbol: (sym) => set({ symbol: sym }),
  reset: () => set({ 
    isActive: false, 
    isPlaying: false, 
    speedMultiplier: 1, 
    progressPercentage: 0, 
    currentTicks: {},
    symbol: "" 
  }),
}));
