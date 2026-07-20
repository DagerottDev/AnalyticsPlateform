"use client";

import { useEffect, useState } from "react";
import { getExpiries } from "@/lib/market";
import { ChevronDown, RefreshCw, Search } from "lucide-react";

interface InstrumentSelectorProps {
  symbol: string;
  onSymbolChange: (symbol: string) => void;
  expiry: string | null;
  onExpiryChange: (expiry: string) => void;
}

const INDICES = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"];

export function InstrumentSelector({
  symbol,
  onSymbolChange,
  expiry,
  onExpiryChange,
}: InstrumentSelectorProps) {
  const [expiries, setExpiries] = useState<string[]>([]);
  const [loadingExpiries, setLoadingExpiries] = useState(false);

  useEffect(() => {
    let isMounted = true;
    
    async function fetchExpiries() {
      setLoadingExpiries(true);
      try {
        const data = await getExpiries(symbol);
        if (isMounted) {
          setExpiries(data.expiries);
          if (data.expiries.length > 0 && !data.expiries.includes(expiry || "")) {
            onExpiryChange(data.expiries[0]);
          }
        }
      } catch (error) {
        console.error("Failed to fetch expiries", error);
        // Fallback for UI if backend fails
        if (isMounted) {
          setExpiries(["25-JUL-2024", "01-AUG-2024"]);
          onExpiryChange("25-JUL-2024");
        }
      } finally {
        if (isMounted) setLoadingExpiries(false);
      }
    }

    fetchExpiries();

    return () => {
      isMounted = false;
    };
  }, [symbol]); // Deliberately omit expiry/onExpiryChange to only fetch on symbol change

  const [customSymbol, setCustomSymbol] = useState("");
  const isCustomSymbol = !INDICES.includes(symbol);

  const submitCustomSymbol = () => {
    const trimmed = customSymbol.trim().toUpperCase();
    if (trimmed) onSymbolChange(trimmed);
  };

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      {/* Symbol Selector */}
      <div className="relative w-48">
        <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
          Instrument
        </label>
        <div className="relative">
          <select
            value={symbol}
            onChange={(e) => onSymbolChange(e.target.value)}
            className="w-full appearance-none rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none transition-colors hover:border-[var(--color-border-accent)] focus:border-[var(--color-accent-blue)]"
          >
            {INDICES.map((idx) => (
              <option key={idx} value={idx}>
                {idx}
              </option>
            ))}
            {isCustomSymbol && (
              <option key={symbol} value={symbol}>
                {symbol}
              </option>
            )}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
        </div>
      </div>

      {/* Custom Stock F&O Symbol Entry */}
      <div className="relative w-48">
        <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
          Or Stock Symbol
        </label>
        <div className="relative">
          <input
            type="text"
            value={customSymbol}
            onChange={(e) => setCustomSymbol(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitCustomSymbol();
            }}
            onBlur={submitCustomSymbol}
            placeholder="e.g. RELIANCE"
            className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] py-2 pl-8 pr-3 text-sm text-[var(--color-text-primary)] outline-none transition-colors hover:border-[var(--color-border-accent)] focus:border-[var(--color-accent-blue)]"
          />
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
        </div>
      </div>

      {/* Expiry Selector */}
      <div className="relative w-48">
        <label className="mb-1 flex items-center gap-2 text-xs font-medium text-[var(--color-text-muted)]">
          Expiry
          {loadingExpiries && <RefreshCw className="h-3 w-3 animate-spin" />}
        </label>
        <div className="relative">
          <select
            value={expiry || ""}
            onChange={(e) => onExpiryChange(e.target.value)}
            disabled={loadingExpiries || expiries.length === 0}
            className="w-full appearance-none rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none transition-colors hover:border-[var(--color-border-accent)] focus:border-[var(--color-accent-blue)] disabled:opacity-50"
          >
            {expiries.map((exp) => (
              <option key={exp} value={exp}>
                {exp}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
        </div>
      </div>
    </div>
  );
}
