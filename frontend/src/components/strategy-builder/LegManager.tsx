"use client";

import { useState } from "react";
import { StrategyLeg } from "@/lib/strategy";
import {
  StrategyPresetName,
  SINGLE_EXPIRY_PRESETS,
  MULTI_EXPIRY_PRESETS,
  buildIronCondorLegs,
  buildStraddleLegs,
  buildStrangleLegs,
  buildButterflyLegs,
  buildCalendarLegs,
  buildDiagonalLegs,
} from "@/lib/strategyPresets";
import { Instrument } from "@/types/market";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { Trash2, Plus, Layers, Sparkles } from "lucide-react";

interface LegManagerProps {
  legs: StrategyLeg[];
  onChange: (legs: StrategyLeg[]) => void;
  availableInstruments: Instrument[];
  currentExpiry: string | null;
  lotSize: number;
  spot: number;
  defaultPreset?: StrategyPresetName;
}

const ALL_PRESETS: StrategyPresetName[] = [...SINGLE_EXPIRY_PRESETS, ...MULTI_EXPIRY_PRESETS];

export function LegManager({
  legs,
  onChange,
  availableInstruments,
  currentExpiry,
  lotSize,
  spot,
  defaultPreset = "Iron Condor",
}: LegManagerProps) {
  const [selectedPreset, setSelectedPreset] = useState<StrategyPresetName>(defaultPreset);

  const loadPreset = () => {
    if (!currentExpiry) return;

    const expiries = Array.from(
      new Set(availableInstruments.map(i => i.expiry).filter((e): e is string => !!e))
    ).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
    const nearExpiry = currentExpiry;
    const nearIdx = expiries.indexOf(nearExpiry);
    const farExpiry = expiries[nearIdx + 1] || nearExpiry;

    let presetLegs: StrategyLeg[];
    switch (selectedPreset) {
      case "Iron Condor":
        presetLegs = buildIronCondorLegs(availableInstruments, nearExpiry, spot, lotSize);
        break;
      case "Straddle":
        presetLegs = buildStraddleLegs(availableInstruments, nearExpiry, spot, lotSize);
        break;
      case "Strangle":
        presetLegs = buildStrangleLegs(availableInstruments, nearExpiry, spot, lotSize);
        break;
      case "Butterfly":
        presetLegs = buildButterflyLegs(availableInstruments, nearExpiry, spot, lotSize);
        break;
      case "Calendar":
        presetLegs = buildCalendarLegs(availableInstruments, nearExpiry, farExpiry, spot, lotSize);
        break;
      case "Diagonal":
        presetLegs = buildDiagonalLegs(availableInstruments, nearExpiry, farExpiry, spot, lotSize);
        break;
    }

    // Drop legs where no matching instrument was found for that strike/expiry.
    onChange(presetLegs.filter(l => l.instrument !== null));
  };

  const addLeg = () => {
    const newLeg: StrategyLeg = {
      id: Math.random().toString(36).substr(2, 9),
      instrument: null,
      action: "Buy",
      quantity: lotSize, // Default to 1 lot
      entryPrice: 0,
      iv: 0.15
    };
    onChange([...legs, newLeg]);
  };

  const removeLeg = (id: string) => {
    onChange(legs.filter(l => l.id !== id));
  };

  const updateLeg = (id: string, updates: Partial<StrategyLeg>) => {
    onChange(legs.map(l => l.id === id ? { ...l, ...updates } : l));
  };

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] pb-4">
        <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--color-text-bright)]">
          <Layers className="h-4 w-4 text-[var(--color-accent-blue)]" /> Strategy Legs
        </h3>
        <span className="text-[10px] font-medium text-[var(--color-text-muted)]">
          {lotSize > 0 ? `Lot Size: ${lotSize}` : "Lot size unavailable"}
        </span>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-dashed border-[var(--color-border-default)] p-2">
        <Sparkles className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
        <Select
          className="flex-1"
          value={selectedPreset}
          onChange={e => setSelectedPreset(e.target.value as StrategyPresetName)}
        >
          {ALL_PRESETS.map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={loadPreset}
          disabled={!currentExpiry || lotSize <= 0}
          className="whitespace-nowrap"
        >
          Load Preset
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        {legs.map((leg) => (
          <div
            key={leg.id}
            className={cn(
              "flex flex-col gap-2 rounded-md border-l-2 border-y border-r border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] p-2",
              leg.action === "Buy" ? "border-l-[var(--color-profit)]" : "border-l-[var(--color-loss)]"
            )}
          >
            {/* Identity row: side + strike + remove */}
            <div className="flex items-center gap-2">
              <div className="flex shrink-0 overflow-hidden rounded-md border border-[var(--color-border-default)]">
                <button
                  type="button"
                  onClick={() => updateLeg(leg.id, { action: "Buy" })}
                  className={cn(
                    "px-3 py-2 text-xs font-bold transition-colors",
                    leg.action === "Buy"
                      ? "bg-[var(--color-profit)]/15 text-[var(--color-profit)]"
                      : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]"
                  )}
                >
                  Buy
                </button>
                <button
                  type="button"
                  onClick={() => updateLeg(leg.id, { action: "Sell" })}
                  className={cn(
                    "border-l border-[var(--color-border-default)] px-3 py-2 text-xs font-bold transition-colors",
                    leg.action === "Sell"
                      ? "bg-[var(--color-loss)]/15 text-[var(--color-loss)]"
                      : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]"
                  )}
                >
                  Sell
                </button>
              </div>

              <div className="min-w-0 flex-1">
                <Select
                  value={leg.instrument?.trading_symbol || ""}
                  onChange={e => {
                    const inst = availableInstruments.find(i => i.trading_symbol === e.target.value);
                    updateLeg(leg.id, { instrument: inst || null });
                  }}
                >
                  <option value="">Select Strike...</option>
                  {availableInstruments.filter(i => i.expiry === currentExpiry).map(i => (
                    <option key={i.trading_symbol} value={i.trading_symbol}>
                      {i.strike} {i.option_type}
                    </option>
                  ))}
                </Select>
              </div>

              <Button variant="icon" onClick={() => removeLeg(leg.id)} aria-label="Remove leg" className="shrink-0">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            {/* Details row: quantity + entry price */}
            <div className="flex items-center gap-2 pl-1">
              <label className="text-[10px] font-medium text-[var(--color-text-muted)]">Qty</label>
              <Input
                type="number"
                step={lotSize || 1}
                min={lotSize || 1}
                value={leg.quantity}
                onChange={e => updateLeg(leg.id, { quantity: Number(e.target.value) })}
                placeholder="Qty"
                className="w-24 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <label className="ml-2 text-[10px] font-medium text-[var(--color-text-muted)]">Price</label>
              <Input
                type="number"
                step="0.05"
                value={leg.entryPrice}
                onChange={e => updateLeg(leg.id, { entryPrice: Number(e.target.value) })}
                placeholder="Price"
                className="w-24 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>
          </div>
        ))}

        {legs.length === 0 && (
          <EmptyState
            className="py-4"
            title="No legs added."
            description="Add a leg to start building your strategy."
          />
        )}
      </div>

      <Button variant="outline" onClick={addLeg} disabled={lotSize <= 0} className="mt-2 w-full border-dashed">
        <Plus className="h-4 w-4" /> Add Leg
      </Button>
    </Card>
  );
}
