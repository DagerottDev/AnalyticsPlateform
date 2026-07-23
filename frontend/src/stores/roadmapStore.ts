import { create } from "zustand";
import { persist } from "zustand/middleware";

interface RoadmapState {
  completed: Record<string, boolean>;
  toggleComplete: (id: string) => void;
  resetProgress: () => void;
}

export const useRoadmapStore = create<RoadmapState>()(
  persist(
    (set) => ({
      completed: {},

      toggleComplete: (id: string) => {
        set((state) => ({
          completed: { ...state.completed, [id]: !state.completed[id] },
        }));
      },

      resetProgress: () => set({ completed: {} }),
    }),
    { name: "roadmap-storage" }
  )
);
