import { describe, it, expect } from "vitest";
import { generateRandomWalk } from "../lib/replayEngine";

describe("Replay Engine GBM Math", () => {
  it("generates random walk with correct length", () => {
    const startPrice = 22000;
    const steps = 375;
    const path = generateRandomWalk(startPrice, 0.15, steps);
    
    // Path includes the start price, so length is steps
    expect(path.length).toBe(steps);
    expect(path[0]).toBe(startPrice);
  });

  it("produces reasonable simulated prices", () => {
    const startPrice = 10000;
    const path = generateRandomWalk(startPrice, 0.20, 100);
    
    // Prices shouldn't explode or drop to 0 instantly
    path.forEach(price => {
      expect(price).toBeGreaterThan(5000);
      expect(price).toBeLessThan(20000);
    });
  });
});
