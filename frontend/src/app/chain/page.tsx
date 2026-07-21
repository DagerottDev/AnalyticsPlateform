"use client";

import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { InstrumentSelector } from "@/components/market/InstrumentSelector";
import { OptionChain } from "@/components/market/OptionChain";
import { Card } from "@/components/ui/Card";
import { PageContainer } from "@/components/ui/PageContainer";
import { SectionHeader } from "@/components/ui/SectionHeader";

export default function OptionChainPage() {
  const [symbol, setSymbol] = useState("NIFTY");
  const [expiry, setExpiry] = useState<string | null>(null);

  return (
    <DashboardLayout>
      <PageContainer className="max-w-[1400px]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <SectionHeader title="Option Chain" description="Live options data and Greeks" />

          <Card className="p-3">
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
