"use client";

import { useEffect, useState } from "react";
import { getExpiries } from "@/lib/market";
import { formatApiError } from "@/lib/apiError";
import { ChevronDown, RefreshCw, Search } from "lucide-react";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";

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
  const [expiriesError, setExpiriesError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function fetchExpiries() {
      setLoadingExpiries(true);
      try {
        const data = await getExpiries(symbol);
        if (isMounted) {
          setExpiriesError(null);
          setExpiries(data.expiries);
          if (data.expiries.length > 0 && !data.expiries.includes(expiry || "")) {
            onExpiryChange(data.expiries[0]);
          }
        }
      } catch (err) {
        if (isMounted) {
          setExpiries([]);
          setExpiriesError(formatApiError(err) || "Failed to load expiries.");
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
          <Select
            value={symbol}
            onChange={(e) => onSymbolChange(e.target.value)}
            className="appearance-none pr-8"
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
          </Select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
        </div>
      </div>

      {/* Custom Stock F&O Symbol Entry */}
      <div className="relative w-48">
        <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
          Or Stock Symbol
        </label>
        <div className="relative">
          <Input
            type="text"
            value={customSymbol}
            onChange={(e) => setCustomSymbol(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitCustomSymbol();
            }}
            onBlur={submitCustomSymbol}
            placeholder="e.g. RELIANCE"
            className="pl-8"
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
          <Select
            value={expiry || ""}
            onChange={(e) => onExpiryChange(e.target.value)}
            disabled={loadingExpiries || expiries.length === 0}
            className="appearance-none pr-8 disabled:opacity-50"
          >
            {expiries.map((exp) => (
              <option key={exp} value={exp}>
                {exp}
              </option>
            ))}
          </Select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
        </div>
        {expiriesError && (
          <p className="mt-1 text-xs text-[var(--color-loss)]">{expiriesError}</p>
        )}
      </div>
    </div>
  );
}
