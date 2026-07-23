"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAlertStore, Alert } from "@/stores/alertStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useMarketData } from "./useMarketData";
import { calculateGreeks, calculateImpliedVolatility } from "@/lib/greeks";
import { getLotSize, calculateContractGEX } from "@/lib/dealerFlow";
import { timeToExpiry, defaultSpotFallback, DEFAULT_RISK_FREE_RATE } from "@/lib/optionMath";
import { getInstruments } from "@/lib/market";
import { sendDesktopNotification } from "@/lib/notifications";
import { Instrument } from "@/types/market";

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

function chainKey(symbol: string, expiry: string) {
  return `${symbol}:${expiry}`;
}

export function useAlertEngine() {
  const { alerts, recordTrigger, rearmAlert } = useAlertStore();
  const notifyToast = useSettingsStore((state) => state.notifyToast);
  const notifyDesktop = useSettingsStore((state) => state.notifyDesktop);

  // Only subscribe to instruments that have ACTIVE alerts (Snoozed alerts don't need live ticks)
  const activeAlerts = useMemo(() => alerts.filter(a => a.status === "Active"), [alerts]);

  // "Net GEX" alerts are scoped to a whole option chain (symbol + expiry), not a single contract —
  // fetch and cache that chain's instrument list so we know which trading symbols to subscribe to.
  const netGexAlerts = useMemo(
    () => activeAlerts.filter(a => a.metric === "Net GEX" && a.instrument.symbol && a.instrument.expiry),
    [activeAlerts]
  );

  const [chainCache, setChainCache] = useState<Record<string, Instrument[]>>({});
  const chainFetchInFlight = useRef<Set<string>>(new Set());

  useEffect(() => {
    netGexAlerts.forEach(alert => {
      const symbol = alert.instrument.symbol;
      const expiry = alert.instrument.expiry as string;
      const key = chainKey(symbol, expiry);
      if (chainCache[key] || chainFetchInFlight.current.has(key)) return;

      chainFetchInFlight.current.add(key);
      getInstruments(symbol)
        .then(data => {
          const filtered = data.instruments.filter(i => i.expiry === expiry && i.strike && i.option_type);
          setChainCache(prev => ({ ...prev, [key]: filtered }));
        })
        .catch(() => {})
        .finally(() => chainFetchInFlight.current.delete(key));
    });
  }, [netGexAlerts, chainCache]);

  const tradingSymbols = useMemo(() => {
    const syms = new Set<string>();
    activeAlerts.forEach(a => {
      syms.add(a.instrument.trading_symbol);
      // If it's an option, we also need the underlying to calculate greeks
      if (a.instrument.symbol) {
        syms.add(a.instrument.symbol);
      }
    });
    netGexAlerts.forEach(a => {
      const key = chainKey(a.instrument.symbol, a.instrument.expiry as string);
      chainCache[key]?.forEach(i => syms.add(i.trading_symbol));
    });
    return Array.from(syms);
  }, [activeAlerts, netGexAlerts, chainCache]);

  const { getTick } = useMarketData(tradingSymbols);

  // Use a ref to prevent double-firing in strict mode / within the same render pass
  const triggeredRefs = useRef<Set<string>>(new Set());

  // Auto-rearm Snoozed alerts once their cooldown has elapsed
  useEffect(() => {
    const snoozed = alerts.filter(a => a.status === "Snoozed" && a.snoozedUntil);
    if (snoozed.length === 0) return;

    const interval = setInterval(() => {
      const now = Date.now();
      snoozed.forEach(alert => {
        if (alert.snoozedUntil && new Date(alert.snoozedUntil).getTime() <= now) {
          triggeredRefs.current.delete(alert.id);
          rearmAlert(alert.id);
        }
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [alerts, rearmAlert]);

  function computeNetGex(alert: Alert): number | null {
    const symbol = alert.instrument.symbol;
    const expiry = alert.instrument.expiry;
    if (!symbol || !expiry) return null;

    const chain = chainCache[chainKey(symbol, expiry)];
    if (!chain || chain.length === 0) return null;

    const underlyingTick = getTick(symbol);
    const S = underlyingTick?.last_price || defaultSpotFallback(symbol);
    const T = timeToExpiry(expiry);
    const lotSize = getLotSize(symbol);

    let netGex = 0;
    let sawTick = false;

    chain.forEach(inst => {
      const tick = getTick(inst.trading_symbol);
      if (!tick || !inst.strike || !inst.option_type) return;
      sawTick = true;

      const optionType = inst.option_type as "CE" | "PE";
      const iv = calculateImpliedVolatility(optionType, S, inst.strike, T, DEFAULT_RISK_FREE_RATE, tick.last_price);
      if (iv <= 0) return;

      const greeks = calculateGreeks(optionType, S, inst.strike, T, DEFAULT_RISK_FREE_RATE, iv);
      const oi = tick.open_interest || 0;
      netGex += calculateContractGEX(greeks.gamma, oi, S, lotSize, optionType);
    });

    return sawTick ? netGex : null;
  }

  useEffect(() => {
    if (activeAlerts.length === 0) return;

    activeAlerts.forEach(alert => {
      if (triggeredRefs.current.has(alert.id)) return;

      let currentValue: number | null = null;

      if (alert.metric === "Net GEX") {
        currentValue = computeNetGex(alert);
      } else if (alert.metric === "VWAP Breakout") {
        const tick = getTick(alert.instrument.trading_symbol);
        if (tick && tick.atp) {
          currentValue = tick.last_price - tick.atp;
        }
      } else {
        const tick = getTick(alert.instrument.trading_symbol);
        if (!tick) return;

        // Price Alert
        if (alert.metric === "Price") {
          currentValue = tick.last_price;
        }
        // Greeks / IV / Call GEX / Put GEX require underlying spot price
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
            else if (alert.metric === "Call GEX" || alert.metric === "Put GEX") {
              const lotSize = getLotSize(alert.instrument.symbol);
              const oi = tick.open_interest || 0;
              const gex = calculateContractGEX(greeks.gamma, oi, S, lotSize, alert.instrument.option_type as "CE" | "PE");
              // Simplified for single contract
              currentValue = gex;
            }
          }
        }
      }

      // Check threshold
      if (currentValue !== null && evaluate(currentValue, alert.operator, alert.threshold)) {
        triggeredRefs.current.add(alert.id);

        const title = `Alert Triggered: ${alert.instrument.trading_symbol}`;
        const description = `${alert.metric} is ${alert.operator} ${alert.threshold} (Current: ${currentValue.toFixed(4)})${
          alert.cooldownMinutes > 0 ? ` — snoozing ${alert.cooldownMinutes}m` : ""
        }`;

        if (notifyToast) {
          toast.success(title, { description, duration: 10000 });
        }
        if (notifyDesktop) {
          sendDesktopNotification(title, description);
        }

        // Update store: snoozes (cooldown > 0) or removes the one-shot alert, and logs the event
        recordTrigger(alert.id, currentValue);
      }
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps -- computeNetGex closes over chainCache/getTick, already in deps below
  }, [activeAlerts, getTick, recordTrigger, chainCache, notifyToast, notifyDesktop]);

  return null; // This is a logic-only component
}
