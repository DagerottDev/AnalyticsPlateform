import { describe, expect, it } from "vitest";
import { simulateStrategyPnl } from "@/lib/monteCarlo";
const leg = { id:"1", action:"Buy" as const, quantity:1, entryPrice:5, iv:.2, instrument:{trading_symbol:"NIFTYCE",symbol:"NIFTY",instrument_type:"OPTIDX",expiry:"2027-12-31",strike:100,option_type:"CE" as const,exchange:"NFO"} };
describe("strategy Monte Carlo",()=>{ it("returns a reproducible P&L distribution",()=>{ const a=simulateStrategyPnl([leg],100,200); const b=simulateStrategyPnl([leg],100,200); expect(a?.bins.reduce((n,x)=>n+x.count,0)).toBe(200); expect(a?.expectedPnl).toBe(b?.expectedPnl); expect(a?.probabilityOfProfit).toBeGreaterThan(0); }); });
