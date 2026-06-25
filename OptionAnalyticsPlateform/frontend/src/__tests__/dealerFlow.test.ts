import { describe, it, expect } from "vitest";
import { 
  calculateContractGEX, 
  calculateZeroGamma, 
  findGammaWalls,
  StrikeExposure 
} from "../lib/dealerFlow";

describe("Dealer Flow Engine", () => {
  it("calculates nominal GEX correctly", () => {
    // gamma, oi, spot, lotSize, type
    const ceGex = calculateContractGEX(0.02, 1000, 22000, 25, "CE");
    // 0.02 * 1000 * 25 * 22000 = 11,000,000
    expect(ceGex).toBe(11000000);

    const peGex = calculateContractGEX(0.02, 1000, 22000, 25, "PE");
    expect(peGex).toBe(-11000000);
  });

  it("finds gamma walls correctly", () => {
    const profile: StrikeExposure[] = [
      { strike: 21000, callExposure: 1000, putExposure: -5000, totalExposure: -4000 },
      { strike: 21500, callExposure: 2000, putExposure: -8000, totalExposure: -6000 }, // Put Wall
      { strike: 22000, callExposure: 4000, putExposure: -4000, totalExposure: 0 },
      { strike: 22500, callExposure: 9000, putExposure: -1000, totalExposure: 8000 }, // Call Wall
      { strike: 23000, callExposure: 3000, putExposure: -500, totalExposure: 2500 },
    ];

    const walls = findGammaWalls(profile);
    expect(walls.callWall).toBe(22500);
    expect(walls.putWall).toBe(21500);
  });

  it("calculates zero gamma proxy correctly", () => {
    const profile: StrikeExposure[] = [
      { strike: 21000, callExposure: 1000, putExposure: -5000, totalExposure: -4000 },
      { strike: 21500, callExposure: 2000, putExposure: -8000, totalExposure: -6000 }, 
      { strike: 22000, callExposure: 4000, putExposure: -4000, totalExposure: 0 }, // Zero Gamma
      { strike: 22500, callExposure: 9000, putExposure: -1000, totalExposure: 8000 }, 
      { strike: 23000, callExposure: 3000, putExposure: -500, totalExposure: 2500 },
    ];

    const zg = calculateZeroGamma(profile);
    expect(zg).toBe(22000);
  });
});
