"use client";

import { useEffect, useMemo, useState } from "react";
import { useTickerStore } from "@/stores/tickerStore";
import { searchSymbols } from "@/lib/market";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Plus, X, Search, Check, TrendingUp, BarChart2 } from "lucide-react";
import type { SymbolSuggestion } from "@/types/market";

interface AddTickerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PRESET_INDICES = [
  { symbol: "NIFTY", label: "NIFTY 50" },
  { symbol: "BANKNIFTY", label: "BANKNIFTY" },
  { symbol: "FINNIFTY", label: "FINNIFTY" },
  { symbol: "MIDCPNIFTY", label: "MIDCPNIFTY" },
  { symbol: "SENSEX", label: "S&P BSE SENSEX" },
];

const PRESET_STOCKS = [
  { symbol: "RELIANCE", label: "Reliance Industries" },
  { symbol: "HDFCBANK", label: "HDFC Bank" },
  { symbol: "ICICIBANK", label: "ICICI Bank" },
  { symbol: "INFY", label: "Infosys" },
  { symbol: "TCS", label: "Tata Consultancy Services" },
  { symbol: "SBIN", label: "State Bank of India" },
  { symbol: "TATAMOTORS", label: "Tata Motors" },
  { symbol: "BHARTIARTL", label: "Bharti Airtel" },
];

export function AddTickerModal({ isOpen, onClose }: AddTickerModalProps) {
  const { tickers, addTicker, removeTicker } = useTickerStore();
  const [customSymbol, setCustomSymbol] = useState("");
  const [suggestions, setSuggestions] = useState<SymbolSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = customSymbol.trim().toUpperCase();
  const localSuggestions = useMemo<SymbolSuggestion[]>(() => (
    [...PRESET_INDICES, ...PRESET_STOCKS]
      .filter(({ symbol, label }) => !query || symbol.includes(query) || label.toUpperCase().includes(query))
      .map(({ symbol, label }) => ({ symbol, name: label }))
  ), [query]);

  // Keep the modal useful even when the remote search endpoint is unavailable:
  // preset matches appear immediately, then the authenticated static NSE F&O
  // search fills in additional company names after a short debounce.
  useEffect(() => {
    let cancelled = false;
    if (!isOpen || query.length < 2) {
      setSuggestions(query.length > 0 ? localSuggestions : []);
      setSuggestionsLoading(false);
      return () => { cancelled = true; };
    }

    setSuggestions(localSuggestions);
    setSuggestionsLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const remoteMatches = await searchSymbols(query);
        if (cancelled) return;
        const merged = [...localSuggestions, ...remoteMatches].filter((match, index, all) => (
          all.findIndex((candidate) => candidate.symbol === match.symbol) === index
        ));
        setSuggestions(merged.slice(0, 8));
      } catch {
        // Local preset matches are still valid suggestions if the API is
        // temporarily unavailable or the broker session has expired.
      } finally {
        if (!cancelled) setSuggestionsLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isOpen, localSuggestions, query]);

  if (!isOpen) return null;

  const handleAddCustom = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const clean = customSymbol.trim().toUpperCase();
    if (!clean) return;
    addTicker(clean);
    setCustomSymbol("");
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const handleSelectSuggestion = (suggestion: SymbolSuggestion) => {
    addTicker(suggestion.symbol);
    setCustomSymbol("");
    setSuggestions([]);
    setShowSuggestions(false);
    setError(null);
  };

  const toggleSymbol = (symbol: string) => {
    if (tickers.includes(symbol)) {
      if (tickers.length <= 1) {
        setError("You must keep at least one active ticker card.");
        return;
      }
      removeTicker(symbol);
    } else {
      addTicker(symbol);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-2xl border border-[var(--color-border-accent)] bg-[var(--color-bg-surface)] p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[var(--color-border-subtle)] pb-4">
          <div>
            <h3 className="text-lg font-extrabold tracking-tight text-[var(--color-text-bright)] flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-[var(--color-accent-green)]" />
              Manage Global Watchlist
            </h3>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Symbols selected here are available across charts, option analysis, volatility, and dealer flow.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-bright)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Custom Input */}
        <form onSubmit={handleAddCustom} className="mt-4 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-[var(--color-text-muted)]" />
            <input
              type="text"
              placeholder="Add custom symbol (e.g. WIPRO, LT)..."
              value={customSymbol}
              onChange={(e) => {
                setCustomSymbol(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => window.setTimeout(() => setShowSuggestions(false), 150)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setShowSuggestions(false);
                } else if (event.key === "Enter" && suggestions.length > 0) {
                  // Choose the best match instead of submitting the raw
                  // query when the autocomplete list is open.
                  event.preventDefault();
                  handleSelectSuggestion(suggestions[0]);
                }
              }}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={showSuggestions && query.length >= 1}
              aria-controls="watchlist-symbol-suggestions"
              className="w-full rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-hover)] py-2 pl-9 pr-3 text-xs text-[var(--color-text-bright)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-border-accent)]"
            />
            {showSuggestions && query.length >= 1 && (
              <div
                id="watchlist-symbol-suggestions"
                role="listbox"
                className="absolute left-0 right-0 top-full z-20 mt-2 max-h-64 overflow-y-auto rounded-xl border border-[var(--color-border-accent)] bg-[var(--color-bg-surface)] p-1.5 shadow-xl"
              >
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion.symbol}
                    type="button"
                    role="option"
                    aria-selected="false"
                    onMouseDown={(event) => {
                      // Select before the input's blur handler hides the list.
                      event.preventDefault();
                      handleSelectSuggestion(suggestion);
                    }}
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs transition-colors hover:bg-[var(--color-bg-hover)]"
                  >
                    <span className="min-w-0 truncate font-semibold text-[var(--color-text-bright)]">
                      {suggestion.name}
                    </span>
                    <span className="shrink-0 font-mono text-[var(--color-accent-blue)]">
                      {suggestion.symbol}
                    </span>
                  </button>
                ))}
                {suggestionsLoading && (
                  <p className="px-3 py-2 text-[11px] text-[var(--color-text-muted)]">Searching symbols…</p>
                )}
                {!suggestionsLoading && suggestions.length === 0 && (
                  <p className="px-3 py-2 text-[11px] text-[var(--color-text-muted)]">
                    No matching symbols found. Press Add to use the typed symbol.
                  </p>
                )}
              </div>
            )}
          </div>
          <Button type="submit" size="sm" variant="secondary">
            <Plus className="mr-1 h-3.5 w-3.5" /> Add
          </Button>
        </form>

        {error && (
          <p className="mt-2 text-xs font-semibold text-[var(--color-status-critical)]">
            {error}
          </p>
        )}

        {/* Presets Grid */}
        <div className="mt-5 space-y-4 max-h-80 overflow-y-auto pr-1">
          {/* Indices Section */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] flex items-center gap-1.5 mb-2">
              <BarChart2 className="h-3.5 w-3.5 text-[var(--color-accent-cyan)]" /> Major Market Indices
            </p>
            <div className="grid grid-cols-2 gap-2">
              {PRESET_INDICES.map(({ symbol, label }) => {
                const isActive = tickers.includes(symbol);
                return (
                  <button
                    key={symbol}
                    type="button"
                    onClick={() => toggleSymbol(symbol)}
                    className={`flex items-center justify-between rounded-xl border px-3 py-2 text-xs font-semibold transition-all ${
                      isActive
                        ? "border-[var(--color-accent-green)] bg-[var(--color-accent-green)]/10 text-[var(--color-text-bright)]"
                        : "border-[var(--color-border-default)] bg-[var(--color-bg-surface)] text-[var(--color-text-muted)] hover:border-[var(--color-border-accent)] hover:text-[var(--color-text-bright)]"
                    }`}
                  >
                    <span>{label}</span>
                    {isActive ? (
                      <Check className="h-4 w-4 text-[var(--color-accent-green)]" />
                    ) : (
                      <Plus className="h-4 w-4 opacity-50" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Equities Section */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] flex items-center gap-1.5 mb-2">
              <TrendingUp className="h-3.5 w-3.5 text-[var(--color-accent-blue)]" /> Popular Equities
            </p>
            <div className="grid grid-cols-2 gap-2">
              {PRESET_STOCKS.map(({ symbol, label }) => {
                const isActive = tickers.includes(symbol);
                return (
                  <button
                    key={symbol}
                    type="button"
                    onClick={() => toggleSymbol(symbol)}
                    className={`flex items-center justify-between rounded-xl border px-3 py-2 text-xs font-semibold transition-all ${
                      isActive
                        ? "border-[var(--color-accent-blue)] bg-[var(--color-accent-blue)]/10 text-[var(--color-text-bright)]"
                        : "border-[var(--color-border-default)] bg-[var(--color-bg-surface)] text-[var(--color-text-muted)] hover:border-[var(--color-border-accent)] hover:text-[var(--color-text-bright)]"
                    }`}
                  >
                    <span className="truncate pr-1">{label} ({symbol})</span>
                    {isActive ? (
                      <Check className="h-4 w-4 text-[var(--color-accent-blue)]" />
                    ) : (
                      <Plus className="h-4 w-4 opacity-50" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Currently Selected Active Tickers */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">
              Watchlist Symbols ({tickers.length})
            </p>
            <div className="flex flex-wrap gap-1.5">
              {tickers.map((sym) => (
                <Badge
                  key={sym}
                  tone="blue"
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-mono"
                >
                  {sym}
                  {tickers.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeTicker(sym);
                      }}
                      className="ml-1 rounded hover:bg-black/20"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 flex justify-end border-t border-[var(--color-border-subtle)] pt-4">
          <Button onClick={onClose} variant="primary" size="sm">
            Save & Stream Live Data
          </Button>
        </div>
      </div>
    </div>
  );
}
