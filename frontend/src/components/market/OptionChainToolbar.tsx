"use client";

import { BarChart3, Download, Plus, Settings2, ShoppingCart, TrendingUp, X } from "lucide-react";
import { Instrument, MarketTick } from "@/types/market";
import { formatINR } from "@/lib/utils";
import type { MoneynessFilter } from "@/lib/optionChainFilters";
import {
  dynamicSelectionLabel,
  MAX_ANALYSIS_SELECTIONS,
  type AnalysisSelection,
  type DynamicMoneyness,
} from "@/lib/analysisSelections";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Select } from "@/components/ui/Select";
import { EducationPopover } from "@/components/ui/EducationPopover";
import { DataFreshness } from "@/components/market/DataFreshness";

interface OptionChainToolbarProps {
  symbol: string;
  expiry: string | null;
  underlyingTick: MarketTick | null;
  S: number;
  dte: number;

  moneyness: MoneynessFilter;
  onMoneynessChange: (value: MoneynessFilter) => void;
  strikesEachSide: number | null;
  onStrikesEachSideChange: (value: number | null) => void;
  filteredStrikesCount: number;
  strikesCount: number;
  onDownloadCsv: () => void;
  showBuildup: boolean;
  onToggleShowBuildup: () => void;
  showGreeks: boolean;
  onToggleShowGreeks: () => void;

  basketLegsCount: number;
  onOpenBasket: () => void;
  onOpenOpenInterestAnalysis: () => void;
  onOpenCombinedPremiumAnalysis: () => void;
  onOpenStrikeAnalysis: () => void;

  instruments: Instrument[];
  analysisSelections: AnalysisSelection[];
  onRemoveAnalysisSelection: (id: string) => void;
  dynamicOptionType: "CE" | "PE";
  onDynamicOptionTypeChange: (value: "CE" | "PE") => void;
  dynamicMoneyness: DynamicMoneyness;
  onDynamicMoneynessChange: (value: DynamicMoneyness) => void;
  dynamicOffset: number;
  onDynamicOffsetChange: (value: number) => void;
  onAddDynamicAnalysisSelection: () => void;
}

/** The Option Chain's filter/action/dynamic-selection header, extracted
 * verbatim from OptionChain.tsx to keep that file focused on
 * state/data-fetching. */
export function OptionChainToolbar({
  symbol, expiry, underlyingTick, S, dte,
  moneyness, onMoneynessChange, strikesEachSide, onStrikesEachSideChange,
  filteredStrikesCount, strikesCount, onDownloadCsv, showBuildup, onToggleShowBuildup, showGreeks, onToggleShowGreeks,
  basketLegsCount, onOpenBasket, onOpenOpenInterestAnalysis, onOpenCombinedPremiumAnalysis, onOpenStrikeAnalysis,
  instruments, analysisSelections, onRemoveAnalysisSelection,
  dynamicOptionType, onDynamicOptionTypeChange, dynamicMoneyness, onDynamicMoneynessChange,
  dynamicOffset, onDynamicOffsetChange, onAddDynamicAnalysisSelection,
}: OptionChainToolbarProps) {
  return (
    <>
      <div className="flex flex-col gap-3 border-b border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] px-3 py-3 sm:px-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-sm font-medium text-[var(--color-text-secondary)]">
            Underlying ({symbol}): <span className="tnum font-bold text-[var(--color-text-bright)]">{formatINR(S)}</span>
          </span>
          <span className="text-sm font-medium text-[var(--color-text-secondary)]">
            DTE: <span className="tnum font-bold text-[var(--color-text-bright)]">{dte} days</span>
          </span>
          <DataFreshness tick={underlyingTick} />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end">
          <Select
            aria-label="Filter option chain by moneyness"
            value={moneyness}
            onChange={(event) => onMoneynessChange(event.target.value as MoneynessFilter)}
            className="h-8 w-full text-xs sm:w-32"
          >
            <option value="all">All moneyness</option>
            <option value="itm">ITM calls</option>
            <option value="atm">ATM only</option>
            <option value="otm">OTM calls</option>
          </Select>
          <Select
            aria-label="Filter option chain by strike range"
            value={strikesEachSide ?? "all"}
            onChange={(event) => onStrikesEachSideChange(event.target.value === "all" ? null : Number(event.target.value))}
            className="h-8 w-full text-xs sm:w-36"
          >
            <option value="all">All strikes</option>
            <option value="5">±5 strikes</option>
            <option value="10">±10 strikes</option>
            <option value="20">±20 strikes</option>
          </Select>
          <span className="col-span-2 text-right text-[11px] text-[var(--color-text-muted)] sm:col-auto sm:text-left">
            Showing {filteredStrikesCount} of {strikesCount} available strikes
          </span>
          <Button className="w-full justify-center sm:w-auto" variant="outline" size="sm" onClick={onDownloadCsv} title="Export filtered option chain as CSV">
            <Download className="h-4 w-4" /> Export CSV
          </Button>
          <Button className="w-full justify-center sm:w-auto" variant="outline" size="sm" onClick={onToggleShowBuildup}>
            <TrendingUp className="h-4 w-4" />
            {showBuildup ? "Hide Buildup" : "Show Buildup"}
          </Button>
          <Button className="col-span-2 w-full justify-center sm:w-auto" variant="outline" size="sm" onClick={onToggleShowGreeks}>
            <Settings2 className="h-4 w-4" />
            {showGreeks ? "Hide Greeks" : "Show Greeks"}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-b border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <div className="flex items-start gap-1">
          <p className="text-xs text-[var(--color-text-secondary)]">
            Select up to {MAX_ANALYSIS_SELECTIONS} fixed or rolling Call/Put contracts for Greek comparison or combined-premium candles.
          </p>
          <EducationPopover title="Select contracts" description="Use the chart icon for a fixed strike, or add a rolling ATM/OTM/ITM descriptor. Rolling selections follow the current expiry's strike ladder as spot changes." tips={["You can compare up to 10 selections.", "A mix of calls, puts, fixed, and rolling selections is supported."]} links={[{ label: "Options chain and Greeks overview", href: "https://www.optionseducation.org/advancedconcepts/understanding-options-greeks" }]} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="secondary" size="sm" onClick={onOpenBasket} disabled={basketLegsCount === 0}>
            <ShoppingCart className="h-4 w-4" /> Basket ({basketLegsCount})
          </Button>
          <Button variant="outline" size="sm" onClick={onOpenOpenInterestAnalysis} disabled={!expiry}>
            <BarChart3 className="h-4 w-4" /> Open Interest
          </Button>
          <span className="tnum text-xs font-semibold text-[var(--color-text-muted)]">{analysisSelections.length}/{MAX_ANALYSIS_SELECTIONS} selected</span>
          <Button variant="outline" size="sm" onClick={onOpenCombinedPremiumAnalysis} disabled={analysisSelections.length === 0}>
            <BarChart3 className="h-4 w-4" /> Combined Premium
          </Button>
          <Button variant="secondary" size="sm" onClick={onOpenStrikeAnalysis} disabled={analysisSelections.length === 0}>
            <BarChart3 className="h-4 w-4" /> Analyze Greeks
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] px-3 py-2 sm:px-4">
        <span className="text-xs font-medium text-[var(--color-text-secondary)]">Dynamic strike</span>
        <Select aria-label="Dynamic option side" value={dynamicOptionType} onChange={(event) => onDynamicOptionTypeChange(event.target.value as "CE" | "PE")} className="h-8 w-20 text-xs">
          <option value="CE">Call</option><option value="PE">Put</option>
        </Select>
        <Select aria-label="Dynamic strike moneyness" value={dynamicMoneyness} onChange={(event) => onDynamicMoneynessChange(event.target.value as DynamicMoneyness)} className="h-8 w-20 text-xs">
          <option value="ATM">ATM</option><option value="OTM">OTM</option><option value="ITM">ITM</option>
        </Select>
        {dynamicMoneyness !== "ATM" && <Select aria-label="Dynamic strike offset" value={dynamicOffset} onChange={(event) => onDynamicOffsetChange(Number(event.target.value))} className="h-8 w-20 text-xs">
          {[1, 2, 3, 4, 5].map((offset) => <option key={offset} value={offset}>{dynamicMoneyness} {offset}</option>)}
        </Select>}
        <Button variant="outline" size="sm" onClick={onAddDynamicAnalysisSelection} disabled={analysisSelections.length >= MAX_ANALYSIS_SELECTIONS}>
          <Plus className="h-4 w-4" /> Add rolling
        </Button>
        {analysisSelections.length > 0 && <div className="flex flex-wrap items-center gap-1">
          {analysisSelections.map((selection) => <Badge key={selection.id} tone={selection.kind === "dynamic" ? "blue" : "neutral"}>
            {selection.kind === "dynamic" ? dynamicSelectionLabel(selection) : (instruments.find((item) => item.trading_symbol === selection.tradingSymbol)?.strike?.toLocaleString() ?? selection.tradingSymbol)}
            <button type="button" aria-label={`Remove ${selection.kind === "dynamic" ? dynamicSelectionLabel(selection) : selection.tradingSymbol}`} onClick={() => onRemoveAnalysisSelection(selection.id)} className="ml-1 inline-flex align-middle"><X className="h-3 w-3" /></button>
          </Badge>)}
        </div>}
      </div>
    </>
  );
}
