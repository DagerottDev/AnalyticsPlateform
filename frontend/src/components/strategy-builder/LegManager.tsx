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
import { InstrumentSelector } from "@/components/market/InstrumentSelector";
import { Instrument } from "@/types/market";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { Trash2, Plus, Layers } from "lucide-react";

interface LegManagerProps {
  legs: StrategyLeg[];
  onChange: (legs: StrategyLeg[]) => void;
  availableInstruments: Instrument[];
  underlyingSymbol: string;
  onSymbolChange: (symbol: string) => void;
  currentExpiry: string | null;
  onExpiryChange: (expiry: string | null) => void;
  lotSize: number;
  spot: number;
}

const ALL_PRESETS: StrategyPresetName[] = [...SINGLE_EXPIRY_PRESETS, ...MULTI_EXPIRY_PRESETS];

export function LegManager({
  legs,
  onChange,
  availableInstruments,
  underlyingSymbol,
  onSymbolChange,
  currentExpiry,
  onExpiryChange,
  lotSize,
  spot
}: LegManagerProps) {
  const [selectedPreset, setSelectedPreset] = useState<StrategyPresetName>("Iron Condor");

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
      <div className="flex flex-col gap-4 border-b border-[var(--color-border-subtle)] pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-sm font-bold text-[var(--color-text-bright)]">Strategy Legs</h3>
          <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">Lot Size: {lotSize}</p>
        </div>
        <InstrumentSelector
          symbol={underlyingSymbol}
          onSymbolChange={onSymbolChange}
          expiry={currentExpiry}
          onExpiryChange={onExpiryChange}
        />
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-dashed border-[var(--color-border-default)] p-2">
        <Layers className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
        <Select
          className="flex-1"
          value={selectedPreset}
          onChange={e => setSelectedPreset(e.target.value as StrategyPresetName)}
        >
          {ALL_PRESETS.map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </Select>
        <Button variant="outline" size="sm" onClick={loadPreset} disabled={!currentExpiry} className="whitespace-nowrap">
          Load Preset
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        {legs.map((leg) => (
          <div key={leg.id} className="grid grid-cols-12 items-center gap-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] p-2">
            <div className="col-span-12 md:col-span-2">
              <Select
                value={leg.action}
                onChange={e => updateLeg(leg.id, { action: e.target.value as "Buy" | "Sell" })}
              >
                <option value="Buy">Buy</option>
                <option value="Sell">Sell</option>
              </Select>
            </div>

            <div className="col-span-12 md:col-span-3">
               <Input
                 type="number"
                 step={lotSize}
                 min={lotSize}
                 value={leg.quantity}
                 onChange={e => updateLeg(leg.id, { quantity: Number(e.target.value) })}
                 placeholder="Qty"
               />
            </div>

            <div className="col-span-12 md:col-span-4">
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

            <div className="col-span-10 md:col-span-2">
               <Input
                 type="number"
                 step="0.05"
                 value={leg.entryPrice}
                 onChange={e => updateLeg(leg.id, { entryPrice: Number(e.target.value) })}
                 placeholder="Price"
               />
            </div>

            <div className="col-span-2 flex justify-end md:col-span-1">
              <Button variant="icon" onClick={() => removeLeg(leg.id)} aria-label="Remove leg">
                <Trash2 className="h-4 w-4" />
              </Button>
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

      <Button variant="outline" onClick={addLeg} className="mt-2 w-full border-dashed">
        <Plus className="h-4 w-4" /> Add Leg
      </Button>
    </Card>
  );
}
