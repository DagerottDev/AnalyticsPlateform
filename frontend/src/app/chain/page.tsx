"use client";

import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { InstrumentSelector } from "@/components/market/InstrumentSelector";
import { OptionChain } from "@/components/market/OptionChain";

export default function OptionChainPage() {
  const [symbol, setSymbol] = useState("NIFTY");
  const [expiry, setExpiry] = useState<string | null>(null);

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-[1400px] space-y-6 animate-fade-in">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold text-[var(--color-text-bright)]">Option Chain</h2>
            <p className="text-sm text-[var(--color-text-secondary)]">Live options data and Greeks</p>
          </div>
          
          <div className="glass-strong rounded-xl p-3">
            <InstrumentSelector
              symbol={symbol}
              onSymbolChange={setSymbol}
              expiry={expiry}
              onExpiryChange={setExpiry}
            />
          </div>
        </div>

        <OptionChain symbol={symbol} expiry={expiry} />
      </div>
    </DashboardLayout>
  );
}
