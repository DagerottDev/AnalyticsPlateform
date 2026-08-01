import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import type { Instrument } from "@/types/market";

interface SelectedStrikesCardProps {
  instruments: Instrument[];
  expiry: string;
  rollingSelections?: Array<{ label: string; instrument: Instrument | null }>;
}

function formatStrike(strike: number | null): string {
  return strike == null
    ? "Strike unavailable"
    : strike.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

/** A persistent, at-a-glance inventory of the contracts powering the charts. */
export function SelectedStrikesCard({ instruments, expiry, rollingSelections = [] }: SelectedStrikesCardProps) {
  const total = instruments.length + rollingSelections.length;
  return (
    <Card role="region" aria-label="Selected strikes" className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text-bright)]">Selected strikes</h2>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Contracts included in the combined Greek calculations{expiry ? ` · ${expiry}` : ""}.
          </p>
        </div>
        <Badge tone="blue">{total} selected</Badge>
      </div>

      <div role="list" className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {instruments.map((instrument) => (
          <div
            key={instrument.trading_symbol}
            role="listitem"
            aria-label={`${formatStrike(instrument.strike)} ${instrument.option_type ?? "option"} selected`}
            className="flex min-w-0 items-center gap-2 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] px-3 py-2"
          >
            <Badge tone={instrument.option_type === "CE" ? "profit" : "loss"}>
              {instrument.option_type ?? "OPT"}
            </Badge>
            <div className="min-w-0">
              <p className="tnum text-sm font-bold text-[var(--color-text-primary)]">
                {formatStrike(instrument.strike)}
              </p>
              <p className="truncate text-[10px] text-[var(--color-text-muted)]" title={instrument.trading_symbol}>
                {instrument.trading_symbol}
              </p>
            </div>
          </div>
        ))}
        {rollingSelections.map(({ label, instrument }) => (
          <div key={label} role="listitem" aria-label={`${label} rolling selection`} className="flex min-w-0 items-center gap-2 rounded-lg border border-[var(--color-accent-blue)]/40 bg-[var(--color-accent-blue)]/5 px-3 py-2">
            <Badge tone={instrument?.option_type === "PE" ? "loss" : "profit"}>ROLL</Badge>
            <div className="min-w-0"><p className="text-sm font-bold text-[var(--color-text-primary)]">{label}</p><p className="truncate text-[10px] text-[var(--color-text-muted)]" title={instrument?.trading_symbol}>{instrument ? `Now ${formatStrike(instrument.strike)} · ${instrument.trading_symbol}` : "Unavailable at current spot"}</p></div>
          </div>
        ))}
      </div>
    </Card>
  );
}
