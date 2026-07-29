import { describe, it, expect } from "vitest";
import {
  calculateContractGEX,
  calculateContractVannaExposure,
  calculateContractCharmExposure,
  calculateZeroGamma,
  findGammaWalls,
  resolveOpenInterest,
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

  it("calculates vanna exposure with the same CE(+)/PE(-) sign convention as GEX", () => {
    const ceVannaExp = calculateContractVannaExposure(0.001, 1000, 22000, 25, "CE");
    // 0.001 * 1000 * 25 * 22000 = 550,000
    expect(ceVannaExp).toBe(550000);

    const peVannaExp = calculateContractVannaExposure(0.001, 1000, 22000, 25, "PE");
    expect(peVannaExp).toBe(-550000);
  });

  it("calculates charm exposure with the same CE(+)/PE(-) sign convention as GEX", () => {
    const ceCharmExp = calculateContractCharmExposure(-0.02, 1000, 25, "CE");
    // -0.02 * 1000 * 25 = -500
    expect(ceCharmExp).toBe(-500);

    const peCharmExp = calculateContractCharmExposure(-0.02, 1000, 25, "PE");
    expect(peCharmExp).toBe(500);
  });

  it("uses option-chain OI when the live tick has no OI", () => {
    expect(resolveOpenInterest(0, 125000)).toBe(125000);
    expect(resolveOpenInterest(undefined, 125000)).toBe(125000);
    expect(resolveOpenInterest(130000, 125000)).toBe(130000);
    expect(resolveOpenInterest(0, null)).toBe(0);
  });
});
