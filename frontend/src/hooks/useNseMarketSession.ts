"use client";

import { useEffect, useState } from "react";
import { getNseMarketSession, type NseMarketSession } from "@/lib/marketSession";

/** Re-evaluates frequently enough to enter/leave the regular session without a page refresh. */
export function useNseMarketSession(): NseMarketSession {
  const [session, setSession] = useState(getNseMarketSession);

  useEffect(() => {
    const update = () => setSession(getNseMarketSession());
    update();
    const interval = window.setInterval(update, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  return session;
}
