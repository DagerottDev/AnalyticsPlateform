import { describe, expect, it } from "vitest";
import { fitSvi, sviImpliedVolatility } from "@/lib/svi";

describe("SVI volatility smile", () => {
  it("fits a smooth positive smile from sparse market points", () => {
    const model = fitSvi([{ strike: 80, iv: .32 }, { strike: 90, iv: .27 }, { strike: 100, iv: .22 }, { strike: 110, iv: .24 }, { strike: 120, iv: .29 }], 100, .25);
    expect(model).not.toBeNull();
    expect(sviImpliedVolatility(model!, 105, 100, .25)).toBeGreaterThan(0);
    expect(model!.rho).toBeLessThan(1);
  });
  it("falls back when too few points are available", () => {
    expect(fitSvi([{ strike: 100, iv: .2 }], 100, .25)).toBeNull();
  });
});
