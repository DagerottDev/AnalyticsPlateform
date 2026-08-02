"use client";

import { useEffect, useRef, useState } from "react";
import { getExpiries, searchSymbols } from "@/lib/market";
import { latestExpiry } from "@/lib/expiry";
import { formatApiError } from "@/lib/apiError";
import { ChevronDown, RefreshCw, Search, Star, StarOff } from "lucide-react";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useWatchlistStore } from "@/stores/tickerStore";
import type { SymbolSuggestion } from "@/types/market";

const SUGGESTION_DEBOUNCE_MS = 200;

interface InstrumentSelectorProps {
  symbol: string;
  onSymbolChange: (symbol: string) => void;
  expiry: string | null;
  onExpiryChange: (expiry: string) => void;
}

export const INDICES = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX"];

export function InstrumentSelector({
  symbol,
  onSymbolChange,
  expiry,
  onExpiryChange,
}: InstrumentSelectorProps) {
  const watchlist = useWatchlistStore((state) => state.tickers);
  const addToWatchlist = useWatchlistStore((state) => state.addTicker);
  const removeFromWatchlist = useWatchlistStore((state) => state.removeTicker);
  const [expiries, setExpiries] = useState<string[]>([]);
  const [loadingExpiries, setLoadingExpiries] = useState(false);
  const [expiriesError, setExpiriesError] = useState<string | null>(null);
  const selectedExpiryRef = useRef(expiry);
  const onExpiryChangeRef = useRef(onExpiryChange);

  useEffect(() => {
    selectedExpiryRef.current = expiry;
    onExpiryChangeRef.current = onExpiryChange;
  }, [expiry, onExpiryChange]);

  useEffect(() => {
    let isMounted = true;

    async function fetchExpiries() {
      setLoadingExpiries(true);
      try {
        const data = await getExpiries(symbol);
        if (isMounted) {
          setExpiriesError(null);
          setExpiries(data.expiries);
          const defaultExpiry = latestExpiry(data.expiries);
          if (
            defaultExpiry &&
            !data.expiries.includes(selectedExpiryRef.current || "")
          ) {
            onExpiryChangeRef.current(defaultExpiry);
          }
        }
      } catch (err) {
        if (isMounted) {
          console.error("Failed to load expiries", formatApiError(err));
          setExpiries([]);
          setExpiriesError("Failed to load expiries.");
        }
      } finally {
        if (isMounted) setLoadingExpiries(false);
      }
    }

    fetchExpiries();

    return () => {
      isMounted = false;
    };
  }, [symbol]);

  const [customSymbol, setCustomSymbol] = useState("");
  const isCustomSymbol = !INDICES.includes(symbol);
  const isInWatchlist = watchlist.includes(symbol);

  const submitCustomSymbol = () => {
    const trimmed = customSymbol.trim().toUpperCase();
    if (trimmed) onSymbolChange(trimmed);
  };

  const [suggestions, setSuggestions] = useState<SymbolSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    const query = customSymbol.trim();
    if (!query) {
      setSuggestions([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const matches = await searchSymbols(query);
        if (!cancelled) setSuggestions(matches);
      } catch {
        if (!cancelled) setSuggestions([]);
      }
    }, SUGGESTION_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [customSymbol]);

  const selectSuggestion = (suggestion: SymbolSuggestion) => {
    setCustomSymbol(suggestion.symbol);
    setSuggestions([]);
    setShowSuggestions(false);
    onSymbolChange(suggestion.symbol);
  };

  return (
    <div className="grid grid-cols-1 gap-3 sm:flex sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
      {/* Global Watchlist */}
      <div className="w-full sm:w-48">
        <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
          Watchlist
        </label>
        <div className="flex gap-1.5">
          <Select
            aria-label="Choose from global watchlist"
            value={isInWatchlist ? symbol : ""}
            onChange={(event) => {
              if (event.target.value) onSymbolChange(event.target.value);
            }}
            className="min-w-0 flex-1"
          >
            <option value="" disabled>Choose a symbol</option>
            {watchlist.map((watchlistSymbol) => (
              <option key={watchlistSymbol} value={watchlistSymbol}>{watchlistSymbol}</option>
            ))}
          </Select>
          <Button
            type="button"
            variant="icon"
            onClick={() => isInWatchlist ? removeFromWatchlist(symbol) : addToWatchlist(symbol)}
            disabled={isInWatchlist && watchlist.length <= 1}
            aria-label={isInWatchlist ? `Remove ${symbol} from watchlist` : `Add ${symbol} to watchlist`}
            title={isInWatchlist ? "Remove from watchlist" : "Add to watchlist"}
          >
            {isInWatchlist ? <StarOff className="h-4 w-4" /> : <Star className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Symbol Selector */}
      <div className="relative w-full sm:w-48">
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
      <div className="relative w-full sm:w-48">
        <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
          Or Stock Symbol
        </label>
        <div className="relative">
          <Input
            type="text"
            value={customSymbol}
            onChange={(e) => setCustomSymbol(e.target.value)}
            onFocus={() => setShowSuggestions(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                submitCustomSymbol();
                setShowSuggestions(false);
              } else if (e.key === "Escape") {
                setShowSuggestions(false);
              }
            }}
            onBlur={() => {
              submitCustomSymbol();
              setShowSuggestions(false);
            }}
            placeholder="e.g. RELIANCE"
            className="pl-9"
            autoComplete="off"
          />
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-muted)]" />
          {showSuggestions && suggestions.length > 0 && (
            <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-56 overflow-auto rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] py-1 shadow-lg">
              {suggestions.map((suggestion) => (
                <li key={suggestion.symbol}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      // Fires before the input's onBlur, so selection wins
                      // instead of the raw typed text being committed.
                      e.preventDefault();
                      selectSuggestion(suggestion);
                    }}
                    className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]"
                  >
                    <span className="font-medium">{suggestion.symbol}</span>
                    <span className="truncate text-xs text-[var(--color-text-muted)]">
                      {suggestion.name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Expiry Selector */}
      <div className="relative w-full sm:w-48">
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
          <p className="mt-1 truncate text-xs text-[var(--color-loss)]" title={expiriesError}>
            {expiriesError}
          </p>
        )}
      </div>
    </div>
  );
}
