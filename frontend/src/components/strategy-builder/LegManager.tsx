"use client";

import { StrategyLeg } from "@/lib/strategy";
import { InstrumentSelector } from "@/components/market/InstrumentSelector";
import { Instrument } from "@/types/market";
import { Trash2, Plus } from "lucide-react";

interface LegManagerProps {
  legs: StrategyLeg[];
  onChange: (legs: StrategyLeg[]) => void;
  availableInstruments: Instrument[];
  underlyingSymbol: string;
  onSymbolChange: (symbol: string) => void;
  currentExpiry: string | null;
  onExpiryChange: (expiry: string | null) => void;
  lotSize: number;
}

export function LegManager({
  legs,
  onChange,
  availableInstruments,
  underlyingSymbol,
  onSymbolChange,
  currentExpiry,
  onExpiryChange,
  lotSize
}: LegManagerProps) {

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
    <div className="flex flex-col gap-4 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b border-[var(--color-border-subtle)] pb-4">
        <div>
          <h3 className="text-sm font-bold text-[var(--color-text-bright)]">Strategy Legs</h3>
          <p className="text-[10px] text-[var(--color-text-muted)] mt-1">Lot Size: {lotSize}</p>
        </div>
        <InstrumentSelector
          symbol={underlyingSymbol}
          onSymbolChange={onSymbolChange}
          expiry={currentExpiry}
          onExpiryChange={onExpiryChange}
        />
      </div>

      <div className="flex flex-col gap-2">
        {legs.map((leg, index) => (
          <div key={leg.id} className="grid grid-cols-12 gap-2 items-center rounded bg-[#18181b] p-2 border border-[var(--color-border-subtle)]">
            <div className="col-span-12 md:col-span-2">
              <select 
                className="w-full bg-[#27272a] text-sm text-[var(--color-text-primary)] rounded p-1.5 outline-none border border-[var(--color-border-subtle)]"
                value={leg.action}
                onChange={e => updateLeg(leg.id, { action: e.target.value as "Buy" | "Sell" })}
              >
                <option value="Buy">Buy</option>
                <option value="Sell">Sell</option>
              </select>
            </div>
            
            <div className="col-span-12 md:col-span-3">
               <input 
                 type="number"
                 step={lotSize}
                 min={lotSize}
                 className="w-full bg-[#27272a] text-sm text-[var(--color-text-primary)] rounded p-1.5 outline-none border border-[var(--color-border-subtle)]"
                 value={leg.quantity}
                 onChange={e => updateLeg(leg.id, { quantity: Number(e.target.value) })}
                 placeholder="Qty"
               />
            </div>

            <div className="col-span-12 md:col-span-4">
              <select
                className="w-full bg-[#27272a] text-sm text-[var(--color-text-primary)] rounded p-1.5 outline-none border border-[var(--color-border-subtle)]"
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
              </select>
            </div>

            <div className="col-span-10 md:col-span-2">
               <input 
                 type="number"
                 step="0.05"
                 className="w-full bg-[#27272a] text-sm text-[var(--color-text-primary)] rounded p-1.5 outline-none border border-[var(--color-border-subtle)]"
                 value={leg.entryPrice}
                 onChange={e => updateLeg(leg.id, { entryPrice: Number(e.target.value) })}
                 placeholder="Price"
               />
            </div>

            <div className="col-span-2 md:col-span-1 flex justify-end">
              <button 
                onClick={() => removeLeg(leg.id)}
                className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-accent-red)] transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}

        {legs.length === 0 && (
          <div className="text-center py-4 text-sm text-[var(--color-text-muted)]">
            No legs added. Add a leg to start building your strategy.
          </div>
        )}
      </div>

      <button 
        onClick={addLeg}
        className="mt-2 flex items-center justify-center gap-2 w-full rounded border border-dashed border-[var(--color-border-default)] py-2 text-sm text-[var(--color-text-secondary)] hover:border-[var(--color-accent-blue)] hover:text-[var(--color-accent-blue)] transition-colors"
      >
        <Plus className="w-4 h-4" /> Add Leg
      </button>
    </div>
  );
}
