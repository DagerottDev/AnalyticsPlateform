"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, BookOpen, Loader2, RefreshCw, X } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ApiErrorDisplay } from "@/components/ui/ApiErrorDisplay";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EducationPopover } from "@/components/ui/EducationPopover";
import { PageContainer } from "@/components/ui/PageContainer";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { RelativeValueEducationAside } from "@/components/volatility/RelativeValueEducationAside";
import { getRelativeValueComparison, type RelativeValueInstrument } from "@/lib/relativeValue";
import { useWatchlistStore } from "@/stores/tickerStore";

const QUICK_SYMBOLS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX"];
const MAX_SYMBOLS = 6;

function percent(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined ? "—" : `${(value * 100).toFixed(digits)}%`;
}

function compactGex(value: number | undefined): string {
  if (value === undefined) return "—";
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function toneFor(value: number | null | undefined) {
  return value === undefined || value === null ? "text-[var(--color-text-primary)]" : value >= 0 ? "text-[var(--color-profit)]" : "text-[var(--color-loss)]";
}

export default function RelativeValuePage() {
  const tickers = useWatchlistStore((state) => state.tickers);
  const addTicker = useWatchlistStore((state) => state.addTicker);
  const removeTicker = useWatchlistStore((state) => state.removeTicker);
  const symbols = useMemo(() => tickers.slice(0, MAX_SYMBOLS), [tickers]);
  const [comparisons, setComparisons] = useState<RelativeValueInstrument[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [educationOpen, setEducationOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (symbols.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const response = await getRelativeValueComparison(symbols);
      setComparisons(response.comparisons);
      setGeneratedAt(response.generated_at);
    } catch (cause) {
      setComparisons([]);
      setError(cause);
    } finally {
      setLoading(false);
    }
  }, [symbols]);

  useEffect(() => { void refresh(); }, [refresh]);

  const rows = symbols.map((symbol) => comparisons.find((item) => item.symbol === symbol) ?? { symbol });
  const availableQuickSymbols = QUICK_SYMBOLS.filter((symbol) => !symbols.includes(symbol));

  return (
    <DashboardLayout>
      <PageContainer>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-2">
            <SectionHeader
              title="Relative Value"
              description="Compare nearest-expiry implied volatility, 2% OTM skew, and gamma exposure across your global watchlist."
            />
            <EducationPopover
              title="Relative Value analytics"
              description="This workspace compares the same volatility and gamma concepts across a small basket. It highlights relative differences; it does not decide whether an instrument is cheap or expensive in isolation."
              tips={["Check each instrument's expiry because nearest active expiries can differ.", "Skew and GEX are model outputs that need spot, liquidity, and event context."]}
              links={[{ label: "OIC: Volatility and the Greeks", href: "https://www.optionseducation.org/advancedconcepts/volatility-the-greeks" }]}
            />
          </div>
          <div className="flex items-center gap-2">
            {!educationOpen && (
              <Button variant="outline" size="sm" onClick={() => setEducationOpen(true)}>
                <BookOpen className="h-4 w-4" /> Show education
              </Button>
            )}
            <Button variant="secondary" onClick={() => void refresh()} disabled={loading || symbols.length === 0}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh snapshot
            </Button>
          </div>
        </div>

        <div className={educationOpen ? "grid items-start gap-4 xl:grid-cols-[280px_minmax(0,1fr)]" : ""}>
          {educationOpen && <RelativeValueEducationAside onClose={() => setEducationOpen(false)} />}
          <div className="flex min-w-0 flex-col gap-4">
            <Card className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">Comparison basket</span>
                {symbols.map((symbol) => (
                  <Badge key={symbol} tone="blue" className="gap-1.5 py-1 text-xs">
                    {symbol}
                    {symbols.length > 1 && <button aria-label={`Remove ${symbol}`} onClick={() => removeTicker(symbol)} className="rounded hover:text-white"><X className="h-3 w-3" /></button>}
                  </Badge>
                ))}
                {availableQuickSymbols.map((symbol) => (
                  <Button key={symbol} size="sm" variant="outline" disabled={symbols.length >= MAX_SYMBOLS} onClick={() => addTicker(symbol)}>+ {symbol}</Button>
                ))}
              </div>
              <p className="text-xs text-[var(--color-text-secondary)]">This basket is shared with Dashboard, Charts, Option Chain, Volatility, and Dealer Flow. Maximum {MAX_SYMBOLS} instruments per comparison to protect broker limits.</p>
            </Card>

            {error !== null && <ApiErrorDisplay error={error} />}

            <Card className="overflow-hidden p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[920px] text-left text-sm">
                  <thead className="border-b border-[var(--color-border-default)] bg-[var(--color-bg-hover)] text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
                    <tr>
                      <th className="px-4 py-3">Instrument</th>
                      <th className="px-4 py-3 text-right">Spot</th>
                      <th className="px-4 py-3 text-right">ATM IV</th>
                      <th className="px-4 py-3 text-right">OTM put IV</th>
                      <th className="px-4 py-3 text-right">OTM call IV</th>
                      <th className="px-4 py-3 text-right">Put − call skew</th>
                      <th className="px-4 py-3 text-right">Net GEX</th>
                      <th className="px-4 py-3 text-right">IV Rank</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => <ComparisonRow key={row.symbol} row={row} loading={loading} />)}
                  </tbody>
                </table>
              </div>
            </Card>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <RankingCard title="Richest ATM IV" rows={rows} value={(row) => row.atm_iv} formatter={(value) => percent(value)} />
              <RankingCard title="Most put-heavy skew" rows={rows} value={(row) => row.skew} formatter={(value) => percent(value)} />
              <RankingCard title="Largest positive GEX" rows={rows} value={(row) => row.net_gex} formatter={(value) => compactGex(value)} />
            </div>

            <p className="text-xs text-[var(--color-text-muted)]">
              {generatedAt ? `Last snapshot: ${new Date(generatedAt).toLocaleString()}. ` : ""}
              Skew compares 2% OTM put and call IV. GEX is a normalized nearest-expiry OI model using observed ATM IV; it is a comparison signal, not a dealer-position estimate. IV Rank appears after at least two daily IV snapshots have accumulated.
            </p>
          </div>
        </div>
      </PageContainer>
    </DashboardLayout>
  );
}

function ComparisonRow({ row, loading }: { row: RelativeValueInstrument; loading: boolean }) {
  if (row.error) {
    return <tr className="border-b border-[var(--color-border-subtle)]"><td className="px-4 py-4 font-bold">{row.symbol}</td><td className="px-4 py-4 text-xs text-[var(--color-loss)]" colSpan={8}>{row.error}</td></tr>;
  }
  return (
    <tr className="border-b border-[var(--color-border-subtle)] last:border-0">
      <td className="px-4 py-4"><div className="font-bold text-[var(--color-text-primary)]">{row.symbol}</div><div className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">{row.expiry ? `Expiry ${row.expiry}` : "Loading chain…"}</div></td>
      <td className={`tnum px-4 py-4 text-right font-semibold ${toneFor(row.change_percent)}`}>{row.spot === undefined ? "—" : <>{row.spot.toLocaleString(undefined, { maximumFractionDigits: 2 })}<span className="ml-1 text-[10px]">({row.change_percent?.toFixed(2)}%)</span></>}</td>
      <td className="tnum px-4 py-4 text-right font-bold">{percent(row.atm_iv)}</td>
      <td className="tnum px-4 py-4 text-right">{percent(row.put_iv)}</td>
      <td className="tnum px-4 py-4 text-right">{percent(row.call_iv)}</td>
      <td className={`tnum px-4 py-4 text-right font-semibold ${toneFor(row.skew)}`}>{percent(row.skew)}</td>
      <td className={`tnum px-4 py-4 text-right font-semibold ${toneFor(row.net_gex)}`}>{compactGex(row.net_gex)}</td>
      <td className="tnum px-4 py-4 text-right">{row.iv_rank === null || row.iv_rank === undefined ? "Building" : `${row.iv_rank.toFixed(1)}%`}</td>
      <td className="px-4 py-4">{loading && row.atm_iv === undefined ? <Badge tone="orange">Loading</Badge> : <Badge tone={row.error ? "loss" : "profit"}>{row.error ? "Unavailable" : "Ready"}</Badge>}</td>
    </tr>
  );
}

function RankingCard({ title, rows, value, formatter }: { title: string; rows: RelativeValueInstrument[]; value: (row: RelativeValueInstrument) => number | null | undefined; formatter: (value: number) => string }) {
  const ranked = rows.filter((row) => value(row) !== null && value(row) !== undefined && !row.error).sort((left, right) => (value(right) ?? -Infinity) - (value(left) ?? -Infinity)).slice(0, 3);
  return <Card><h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]"><BarChart3 className="h-3.5 w-3.5" />{title}</h2><div className="mt-3 space-y-2">{ranked.length ? ranked.map((row, index) => <div className="flex items-center justify-between text-sm" key={row.symbol}><span className="text-[var(--color-text-secondary)]"><span className="mr-2 text-[var(--color-text-muted)]">{index + 1}</span>{row.symbol}</span><b className="tnum">{formatter(value(row)!)}</b></div>) : <p className="text-sm text-[var(--color-text-muted)]">Awaiting a usable snapshot.</p>}</div></Card>;
}
