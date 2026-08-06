"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { buildMarketStructure, gammaFlip, type MarketSignMode } from "@/lib/marketStructure";
import type { Instrument, MarketTick } from "@/types/market";

interface MarketStructurePanelProps { instruments: Instrument[]; ticks: Record<string, MarketTick>; spot: number; rate: number; }

export function MarketStructurePanel({ instruments, ticks, spot, rate }: MarketStructurePanelProps) {
  const [signMode, setSignMode] = useState<MarketSignMode>("neutral");
  const profile = useMemo(() => buildMarketStructure(instruments, ticks, spot, rate, signMode), [instruments, ticks, spot, rate, signMode]);
  const flip = gammaFlip(profile);
  const complete = profile.reduce((sum, row) => sum + row.complete, 0);
  const total = profile.reduce((sum, row) => sum + row.total, 0);
  const totalGamma = profile.reduce((sum, row) => sum + row.gamma, 0);
  const maximum = Math.max(1, ...profile.flatMap((row) => [Math.abs(row.gamma), Math.abs(row.vanna), Math.abs(row.charm)]));
  const guide = totalGamma > 0 ? "Positive hypothetical gamma: price moves may be dampened by hedging, but confirm with spot/ATR and liquidity." : totalGamma < 0 ? "Negative hypothetical gamma: moves may be amplified; prefer defined-risk structures and strict invalidation." : "No directional gamma regime is available from current complete data.";
  return <Card className="flex flex-col gap-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-[var(--color-text-bright)]">Market Structure — full-expiry OI concentrations</h2><p className="mt-1 max-w-3xl text-xs text-[var(--color-text-secondary)]">OI is outstanding contract count, not participant direction. Neutral mode is unsigned concentration; hypothetical dealer modes are assumptions, never a fact.</p></div><label className="text-xs text-[var(--color-text-secondary)]">Exposure convention<Select aria-label="Market structure exposure convention" value={signMode} onChange={(event) => setSignMode(event.target.value as MarketSignMode)} className="mt-1 h-8 w-48 text-xs"><option value="neutral">Neutral concentration</option><option value="dealer-short">Customer long / dealer short</option><option value="dealer-long">Customer short / dealer long</option></Select></label></div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Metric label="OI quote coverage" value={`${complete}/${total}`} /><Metric label="Spot" value={spot.toFixed(2)} /><Metric label="Gamma transition" value={flip?.toFixed(0) ?? "No crossing"} /><Metric label="Model gamma" value={totalGamma.toExponential(2)} /></div>
    <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-xs"><thead className="text-left text-[var(--color-text-muted)]"><tr><th>Strike</th><th>Lot-adjusted OI</th><th>Session OI Δ</th><th>Gamma</th><th>Delta</th><th>Vega</th><th>Vanna</th><th>Charm</th></tr></thead><tbody>{profile.map((row) => <tr key={row.strike} className="border-t border-[var(--color-border-subtle)]"><td className="py-2">{row.strike}</td><td>{row.oi.toLocaleString("en-IN")}</td><td>{row.oiChange.toLocaleString("en-IN")}</td><Heat value={row.gamma} maximum={maximum}>{row.gamma.toExponential(2)}</Heat><td>{row.delta.toFixed(2)}</td><td>{row.vega.toFixed(2)}</td><Heat value={row.vanna} maximum={maximum}>{row.vanna.toFixed(4)}</Heat><Heat value={row.charm} maximum={maximum}>{row.charm.toFixed(4)}</Heat></tr>)}</tbody></table></div>
    <div className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-tertiary)] p-3 text-xs text-[var(--color-text-secondary)]"><b className="text-[var(--color-text-primary)]">Scenario guide:</b> {guide} Use this only with the My Risk scenarios and a user-reviewed defined-risk strategy; it does not create orders or predict direction.</div>
  </Card>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded border border-[var(--color-border-subtle)] p-2"><p className="text-[10px] uppercase text-[var(--color-text-muted)]">{label}</p><p className="tnum text-sm font-semibold">{value}</p></div>; }
function Heat({ value, maximum, children }: { value: number; maximum: number; children: ReactNode }) { const alpha = Math.min(.35, Math.abs(value) / maximum * .35); return <td className="px-1" style={{ backgroundColor: value >= 0 ? `rgba(38, 166, 154, ${alpha})` : `rgba(239, 83, 80, ${alpha})` }}>{children}</td>; }
