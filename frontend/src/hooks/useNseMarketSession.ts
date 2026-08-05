"use client";

import { useEffect, useState } from "react";
import { getNseMarketSession, type MarketSegment, type NseMarketSession } from "@/lib/marketSession";

/** Re-evaluates frequently enough to enter/leave the regular session without a page refresh. */
export function useNseMarketSession(segment: MarketSegment = "fno"): NseMarketSession {
  const [session, setSession] = useState(() => getNseMarketSession(new Date(), segment));

  useEffect(() => {
    const update = () => setSession(getNseMarketSession(new Date(), segment));
    update();
    const interval = window.setInterval(update, 30_000);
    return () => window.clearInterval(interval);
  }, [segment]);

  return session;
}
