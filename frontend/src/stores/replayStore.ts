import { create } from "zustand";
import type { Instrument, TickData } from "@/types/market";

export interface ReplayTickMap {
  [symbol: string]: TickData;
}

export interface ReplayPriceCoverage {
  attempted: number;
  matched: number;
}

const REPLAY_CHANNEL_NAME = "option-analytics-replay-v1";

interface ReplayState {
  isActive: boolean;
  isPlaying: boolean;
  speedMultiplier: number;
  progressPercentage: number;
  /** The complete prepared session. Keeping it in the store lets a page
   * opened after playback starts render the replay history instead of seeing
   * only the latest tick. */
  replayTimeline: ReplayTickMap[];
  replayInstruments: Instrument[];
  currentStep: number;
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
  setReplayTimeline: (timeline: ReplayTickMap[]) => void;
  setReplayInstruments: (instruments: Instrument[]) => void;
  setCurrentStep: (step: number) => void;
  setCurrentTicks: (ticks: ReplayTickMap) => void;
  setSymbol: (sym: string) => void;
  setSessionDate: (date: string) => void;
  setExpiry: (expiry: string) => void;
  setStrike: (strike: number | null) => void;
  setOptionSide: (side: "BOTH" | "CE" | "PE") => void;
  setPriceCoverage: (coverage: ReplayPriceCoverage | null) => void;
  reset: () => void;
}

type ReplaySnapshot = Pick<ReplayState,
  | "isActive"
  | "isPlaying"
  | "speedMultiplier"
  | "progressPercentage"
  | "replayTimeline"
  | "replayInstruments"
  | "currentStep"
  | "currentTicks"
  | "symbol"
  | "sessionDate"
  | "expiry"
  | "strike"
  | "optionSide"
  | "priceCoverage"
>;

type ReplayLiveSnapshot = Omit<ReplaySnapshot, "replayTimeline" | "replayInstruments">;

type ReplayMessage =
  | { type: "request" }
  | { type: "timeline"; snapshot: ReplaySnapshot }
  | { type: "state"; snapshot: ReplayLiveSnapshot };

let replayChannel: BroadcastChannel | null = null;

function snapshotOf(state: ReplayState): ReplaySnapshot {
  return {
    isActive: state.isActive,
    isPlaying: state.isPlaying,
    speedMultiplier: state.speedMultiplier,
    progressPercentage: state.progressPercentage,
    replayTimeline: state.replayTimeline,
    replayInstruments: state.replayInstruments,
    currentStep: state.currentStep,
    currentTicks: state.currentTicks,
    symbol: state.symbol,
    sessionDate: state.sessionDate,
    expiry: state.expiry,
    strike: state.strike,
    optionSide: state.optionSide,
    priceCoverage: state.priceCoverage,
  };
}

function publish(type: "timeline" | "state", state: ReplayState) {
  const snapshot = snapshotOf(state);
  if (type === "timeline") {
    replayChannel?.postMessage({ type, snapshot } satisfies ReplayMessage);
    return;
  }
  const { replayTimeline, replayInstruments, ...liveSnapshot } = snapshot;
  void replayTimeline;
  void replayInstruments;
  replayChannel?.postMessage({ type, snapshot: liveSnapshot } satisfies ReplayMessage);
}

const defaultReplayState = {
  isActive: false,
  isPlaying: false,
  speedMultiplier: 1,
  progressPercentage: 0,
  replayTimeline: [] as ReplayTickMap[],
  replayInstruments: [] as Instrument[],
  currentStep: 0,
  currentTicks: {} as ReplayTickMap,
  symbol: "",
  sessionDate: "",
  expiry: "",
  strike: null as number | null,
  optionSide: "BOTH" as const,
  priceCoverage: null as ReplayPriceCoverage | null,
};

export const useReplayStore = create<ReplayState>((set, get) => ({
  ...defaultReplayState,

  setIsActive: (active) => { set({ isActive: active }); publish("state", get()); },
  setIsPlaying: (playing) => { set({ isPlaying: playing }); publish("state", get()); },
  setSpeedMultiplier: (speed) => { set({ speedMultiplier: speed }); publish("state", get()); },
  setProgressPercentage: (percent) => { set({ progressPercentage: percent }); publish("state", get()); },
  setReplayTimeline: (timeline) => {
    set({ replayTimeline: timeline, currentStep: 0, currentTicks: timeline[0] ?? {} });
    publish("timeline", get());
  },
  setReplayInstruments: (instruments) => { set({ replayInstruments: instruments }); publish("state", get()); },
  setCurrentStep: (step) => {
    set((state) => {
      if (state.replayTimeline.length === 0) return { currentStep: Math.max(0, step) };
      const nextStep = Math.max(0, Math.min(Math.trunc(step), state.replayTimeline.length - 1));
      return {
        currentStep: nextStep,
        currentTicks: state.replayTimeline[nextStep] ?? state.currentTicks,
      };
    });
    publish("state", get());
  },
  setCurrentTicks: (ticks) => { set({ currentTicks: ticks }); publish("state", get()); },
  setSymbol: (sym) => { set({ symbol: sym }); publish("state", get()); },
  setSessionDate: (date) => { set({ sessionDate: date }); publish("state", get()); },
  setExpiry: (expiry) => { set({ expiry }); publish("state", get()); },
  setStrike: (strike) => { set({ strike }); publish("state", get()); },
  setOptionSide: (optionSide) => { set({ optionSide }); publish("state", get()); },
  setPriceCoverage: (coverage) => { set({ priceCoverage: coverage }); publish("state", get()); },
  reset: () => { set({ ...defaultReplayState }); publish("state", get()); },
}));

// The Option Chain intentionally opens the Greek workspace in a new window.
// Zustand state is otherwise per-window, so mirror replay state through a
// BroadcastChannel. A new window requests the prepared timeline once and then
// receives only compact current-step updates while playback continues.
if (typeof window !== "undefined" && "BroadcastChannel" in window) {
  replayChannel = new BroadcastChannel(REPLAY_CHANNEL_NAME);
  replayChannel.addEventListener("message", (event: MessageEvent<ReplayMessage>) => {
    const message = event.data;
    if (!message || !message.type) return;
    const current = useReplayStore.getState();
    if (message.type === "request") {
      if (current.isActive || current.replayTimeline.length > 0) publish("timeline", current);
      return;
    }
    if (message.type === "timeline") {
      // Do not let an inactive/stale window clear an active replay received
      // from the window that owns the playback timer.
      if (message.snapshot.isActive || !current.isActive) {
        useReplayStore.setState(message.snapshot);
      }
      return;
    }
    if (message.snapshot.isActive || !current.isActive || current.replayTimeline.length > 0) {
      useReplayStore.setState(message.snapshot);
    }
  });
  replayChannel.postMessage({ type: "request" } satisfies ReplayMessage);
}
