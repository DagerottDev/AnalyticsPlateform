"use client";

import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { InstrumentSelector } from "@/components/market/InstrumentSelector";
import { OptionChain } from "@/components/market/OptionChain";
import { Card } from "@/components/ui/Card";
import { PageContainer } from "@/components/ui/PageContainer";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { useSettingsStore } from "@/stores/settingsStore";
import { useReplayStore } from "@/stores/replayStore";

export default function OptionChainPage() {
  const [symbol, setSymbol] = useState<string>(() => useSettingsStore.getState().defaultSymbol);
  const [expiry, setExpiry] = useState<string | null>(null);
  const replayIsActive = useReplayStore((state) => state.isActive);
  const replaySymbol = useReplayStore((state) => state.symbol);
  const replayExpiry = useReplayStore((state) => state.expiry);

  // Starting a replay from a different symbol/expiry should lead directly to
  // the same ladder when the user opens Option Chain from the replay card.
  // Manual changes remain respected after this initial synchronization.
  useEffect(() => {
    if (!replayIsActive || !replaySymbol) return;
    setSymbol(replaySymbol);
    if (replayExpiry) setExpiry(replayExpiry);
  }, [replayExpiry, replayIsActive, replaySymbol]);

  return (
    <DashboardLayout>
      <PageContainer className="max-w-[1400px]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <SectionHeader title="Option Chain" description="Live options data and Greeks" />

          <Card className="w-full p-3 lg:w-auto">
            <InstrumentSelector
              symbol={symbol}
              onSymbolChange={setSymbol}
              expiry={expiry}
              onExpiryChange={setExpiry}
            />
          </Card>
        </div>

        <OptionChain symbol={symbol} expiry={expiry} />
      </PageContainer>
    </DashboardLayout>
  );
}
