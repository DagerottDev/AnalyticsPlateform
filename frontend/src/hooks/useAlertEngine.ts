"use client";

import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { useAlertStore, Alert } from "@/stores/alertStore";
import { useMarketData } from "./useMarketData";
import { calculateGreeks, calculateImpliedVolatility } from "@/lib/greeks";
import { getLotSize, calculateContractGEX } from "@/lib/dealerFlow";
import { timeToExpiry, defaultSpotFallback, DEFAULT_RISK_FREE_RATE } from "@/lib/optionMath";

// Helper to evaluate condition safely
function evaluate(value: number, operator: string, threshold: number): boolean {
  switch (operator) {
    case ">": return value > threshold;
    case "<": return value < threshold;
    case ">=": return value >= threshold;
    case "<=": return value <= threshold;
    default: return false;
  }
}

export function useAlertEngine() {
  const { alerts, updateAlertStatus } = useAlertStore();
  
  // Only subscribe to instruments that have ACTIVE alerts
  const activeAlerts = useMemo(() => alerts.filter(a => a.status === "Active"), [alerts]);
  
  const tradingSymbols = useMemo(() => {
    const syms = new Set<string>();
    activeAlerts.forEach(a => {
      syms.add(a.instrument.trading_symbol);
      // If it's an option, we also need the underlying to calculate greeks
      if (a.instrument.symbol) {
        syms.add(a.instrument.symbol); 
      }
    });
    return Array.from(syms);
  }, [activeAlerts]);

  const { getTick } = useMarketData(tradingSymbols);

  // Use a ref to prevent double-firing in strict mode
  const triggeredRefs = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (activeAlerts.length === 0) return;

    activeAlerts.forEach(alert => {
      if (triggeredRefs.current.has(alert.id)) return;

      const tick = getTick(alert.instrument.trading_symbol);
      if (!tick) return;

      let currentValue: number | null = null;

      // Price Alert
      if (alert.metric === "Price") {
        currentValue = tick.last_price;
      } 
      // Greeks / IV / GEX require underlying spot price
      else if (alert.instrument.strike && alert.instrument.option_type && alert.instrument.expiry) {
        const underlyingTick = getTick(alert.instrument.symbol);
        const S = underlyingTick?.last_price || defaultSpotFallback(alert.instrument.symbol);

        const T = timeToExpiry(alert.instrument.expiry);
        const r = DEFAULT_RISK_FREE_RATE;

        const iv = calculateImpliedVolatility(
          alert.instrument.option_type as "CE" | "PE",
          S,
          alert.instrument.strike,
          T,
          r,
          tick.last_price
        );

        if (alert.metric === "IV") {
          currentValue = iv * 100; // Store as percentage
        } else if (iv > 0) {
          const greeks = calculateGreeks(
            alert.instrument.option_type as "CE" | "PE",
            S,
            alert.instrument.strike,
            T,
            r,
            iv
          );

          if (alert.metric === "Delta") currentValue = greeks.delta;
          else if (alert.metric === "Gamma") currentValue = greeks.gamma;
          else if (alert.metric === "Theta") currentValue = greeks.theta;
          else if (alert.metric === "Vega") currentValue = greeks.vega;
          else if (alert.metric.includes("GEX")) {
            const lotSize = getLotSize(alert.instrument.symbol);
            const oi = tick.open_interest || 0;
            const gex = calculateContractGEX(greeks.gamma, oi, S, lotSize, alert.instrument.option_type as "CE" | "PE");
            // Simplified for single contract
            currentValue = gex; 
          }
        }
      }

      // Check threshold
      if (currentValue !== null && evaluate(currentValue, alert.operator, alert.threshold)) {
        triggeredRefs.current.add(alert.id);
        
        // Fire toast
        toast.success(`Alert Triggered: ${alert.instrument.trading_symbol}`, {
          description: `${alert.metric} is ${alert.operator} ${alert.threshold} (Current: ${currentValue.toFixed(4)})`,
          duration: 10000,
        });

        // Update store
        updateAlertStatus(alert.id, "Triggered", new Date().toISOString());
      }
    });

  }, [activeAlerts, getTick, updateAlertStatus]);

  return null; // This is a logic-only component
}
