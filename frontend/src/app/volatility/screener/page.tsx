"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, BookOpen, Loader2, RefreshCw, Search } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ApiErrorDisplay } from "@/components/ui/ApiErrorDisplay";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EducationPopover } from "@/components/ui/EducationPopover";
import { Input } from "@/components/ui/Input";
import { PageContainer } from "@/components/ui/PageContainer";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Select } from "@/components/ui/Select";
import { IVScreenerEducationAside } from "@/components/volatility/IVScreenerEducationAside";
import { expectedIvRange, getIvUniverse, type CorporateCalendarStatus, type CorporateEventType, type IvUniverseSymbol } from "@/lib/ivUniverse";
import { useSettingsStore, type IvScreenerSigma } from "@/stores/settingsStore";
import { cn } from "@/lib/utils";

const REFRESH_INTERVAL_MS = 60_000;

type SortKey = "symbol" | "spot" | "atm_iv" | "iv_rank" | "iv_percentile";
type SortDir = "asc" | "desc";
type Status = IvUniverseSymbol["status"];

const PROJECTION_PRESETS = [7, 14, 30, 45, 60] as const;

const COLUMNS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "symbol", label: "Symbol" },
  { key: "spot", label: "Spot", align: "right" },
  { key: "atm_iv", label: "ATM IV", align: "right" },
  { key: "iv_rank", label: "IV Rank", align: "right" },
  { key: "iv_percentile", label: "IV Percentile", align: "right" },
];

function percent(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined ? "—" : `${(value * 100).toFixed(digits)}%`;
}

function points(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${value.toFixed(1)}`;
}

function statusLabel(status: Status): string {
  return status === "ready" ? "Ready" : status === "stale" ? "Stale" : "Building";
}

function statusTone(status: Status): "blue" | "orange" | "profit" {
  return status === "ready" ? "profit" : status === "stale" ? "orange" : "blue";
}

function inr(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function eventLabel(type: CorporateEventType): string {
  return {
    results: "Results",
    board_meeting: "Board meeting",
    dividend: "Dividend",
    split: "Split",
    bonus: "Bonus",
    buyback: "Buyback",
    rights: "Rights",
  }[type];
}

function eventDate(value: string): string {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })
    .format(new Date(`${value}T00:00:00Z`));
}

export default function VolatilityScreenerPage() {
  const [symbols, setSymbols] = useState<IvUniverseSymbol[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [calendarStatus, setCalendarStatus] = useState<CorporateCalendarStatus>("unavailable");
  const [calendarUpdatedAt, setCalendarUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("iv_rank");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [educationOpen, setEducationOpen] = useState(false);
  const ivScreener = useSettingsStore((state) => state.ivScreener);
  const updatePreferences = useSettingsStore((state) => state.updatePreferences);
  const projectionDays = ivScreener.projectionDays;
  const sigma = ivScreener.sigma;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getIvUniverse(projectionDays);
      setSymbols(response.symbols);
      setGeneratedAt(response.generated_at);
      setCalendarStatus(response.corporate_calendar?.status ?? "unavailable");
      setCalendarUpdatedAt(response.corporate_calendar?.updated_at ?? null);
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  }, [projectionDays]);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const rows = useMemo(() => {
    const query = search.trim().toUpperCase();
    const filtered = query
      ? symbols.filter(
          (row) =>
            row.symbol.toUpperCase().includes(query) ||
            row.company_name.toUpperCase().includes(query)
        )
      : symbols;

    const direction = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((left, right) => {
      if (sortKey === "symbol") {
        return direction * left.symbol.localeCompare(right.symbol);
      }
      const leftValue = left[sortKey];
      const rightValue = right[sortKey];
      if (leftValue === null && rightValue === null) return 0;
      if (leftValue === null) return 1; // nulls (not yet captured) sort last regardless of direction
      if (rightValue === null) return -1;
      return direction * (leftValue - rightValue);
    });
  }, [symbols, search, sortKey, sortDir]);

  const setProjectionDays = (value: number) => {
    const next = Math.min(60, Math.max(1, Math.trunc(value) || 1));
    updatePreferences((current) => ({
      ...current,
      ivScreener: { ...current.ivScreener, projectionDays: next },
    }));
  };

  const setSigma = (value: IvScreenerSigma) => {
    updatePreferences((current) => ({
      ...current,
      ivScreener: { ...current.ivScreener, sigma: value },
    }));
  };

  return (
    <DashboardLayout>
      <PageContainer>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-2">
            <SectionHeader
              title="IV Screener"
              description="ATM implied volatility, IV Rank, and IV Percentile across every NSE F&O stock."
            />
            <EducationPopover
              title="IV Screener analytics"
              description="This screener compares daily ATM implied-volatility observations across the NSE F&O universe. IV Rank and IV Percentile are historical context, not directional forecasts."
              tips={["Rank and Percentile are different measures of where today's IV sits in its history.", "Universe Rank and Percentile need at least 20 prior daily observations before becoming ready."]}
              links={[{ label: "OIC: Volatility and the Greeks", href: "https://www.optionseducation.org/advancedconcepts/volatility-the-greeks" }]}
            />
          </div>
          <div className="flex items-center gap-2">
            {!educationOpen && (
              <Button variant="outline" size="sm" onClick={() => setEducationOpen(true)}>
                <BookOpen className="h-4 w-4" /> Show education
              </Button>
            )}
            <Button variant="secondary" onClick={() => void refresh()} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
            </Button>
          </div>
        </div>

        <div className={educationOpen ? "grid items-start gap-4 xl:grid-cols-[280px_minmax(0,1fr)]" : ""}>
          {educationOpen && <IVScreenerEducationAside onClose={() => setEducationOpen(false)} />}
          <div className="flex min-w-0 flex-col gap-4">
            <Card className="flex flex-col gap-3">
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex w-36 flex-col gap-1 text-xs font-semibold text-[var(--color-text-secondary)]">
                  Projection days
                  <Input
                    aria-label="IV range projection days"
                    type="number"
                    min={1}
                    max={60}
                    value={projectionDays}
                    onChange={(event) => setProjectionDays(Number(event.target.value))}
                  />
                </label>
                <div className="flex flex-wrap gap-1" aria-label="Projection day presets">
                  {PROJECTION_PRESETS.map((days) => (
                    <Button
                      key={days}
                      type="button"
                      size="sm"
                      variant={projectionDays === days ? "secondary" : "outline"}
                      onClick={() => setProjectionDays(days)}
                    >
                      {days}D
                    </Button>
                  ))}
                </div>
                <label className="flex w-36 flex-col gap-1 text-xs font-semibold text-[var(--color-text-secondary)]">
                  Confidence
                  <Select
                    aria-label="IV range confidence"
                    value={String(sigma)}
                    onChange={(event) => setSigma(Number(event.target.value) as IvScreenerSigma)}
                  >
                    <option value="1">1σ</option>
                    <option value="1.5">1.5σ</option>
                    <option value="2">2σ</option>
                  </Select>
                </label>
                <div className="relative min-w-[220px] flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
                  <Input
                    aria-label="Search IV screener symbols"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search symbol or company name…"
                    className="pl-9"
                  />
                </div>
              </div>
              <p className="text-xs text-[var(--color-text-secondary)]">
                IV Range is an annualized ATM-IV estimate over {projectionDays} calendar days at {sigma}σ. It does not model event gaps.
                {calendarStatus === "ready" ? " NSE-announced events are checked for this window." : " Event calendar is not fully available; ranges are not event-checked."}
              </p>
            </Card>

            {error !== null && <ApiErrorDisplay error={error} />}

            <Card className="overflow-hidden p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[940px] text-left text-sm">
                  <caption className="sr-only">ATM implied volatility and volatility ranking for NSE F&amp;O stocks</caption>
                  <thead className="border-b border-[var(--color-border-default)] bg-[var(--color-bg-hover)] text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
                    <tr>
                      {COLUMNS.map((column) => (
                        <th
                          key={column.key}
                          scope="col"
                          aria-sort={sortKey === column.key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                          className={cn("px-4 py-2", column.align === "right" && "text-right")}
                        >
                          <button
                            type="button"
                            onClick={() => toggleSort(column.key)}
                            className={cn(
                              "focus-ring inline-flex w-full items-center gap-1 rounded px-2 py-1 text-left hover:text-[var(--color-text-primary)]",
                              column.align === "right" && "justify-end text-right"
                            )}
                            aria-label={`Sort by ${column.label}`}
                          >
                            <span>{column.label}</span>
                            {sortKey === column.key ? (
                              sortDir === "asc" ? (
                                <ArrowUp className="h-3 w-3 shrink-0" aria-hidden="true" />
                              ) : (
                                <ArrowDown className="h-3 w-3 shrink-0" aria-hidden="true" />
                              )
                            ) : (
                              <ArrowUpDown className="h-3 w-3 shrink-0 opacity-30" aria-hidden="true" />
                            )}
                          </button>
                        </th>
                      ))}
                      <th scope="col" className="px-4 py-3 text-right">IV Range</th>
                      <th scope="col" className="px-4 py-3">Events</th>
                      <th scope="col" className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <ScreenerRow
                        key={row.symbol}
                        row={row}
                        projectionDays={projectionDays}
                        sigma={sigma}
                        calendarStatus={calendarStatus}
                      />
                    ))}
                    {loading && rows.length === 0 && (
                      <tr>
                        <td colSpan={COLUMNS.length + 3} className="px-4 py-10 text-center text-sm text-[var(--color-text-secondary)]">
                          <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading IV universe…</span>
                        </td>
                      </tr>
                    )}
                    {rows.length === 0 && !loading && (
                      <tr>
                        <td colSpan={COLUMNS.length + 3} className="px-4 py-8 text-center text-sm text-[var(--color-text-muted)]">
                          No symbols match your search.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <p className="text-xs text-[var(--color-text-muted)]">
              {generatedAt ? `Last loaded: ${new Date(generatedAt).toLocaleString()}. ` : ""}
              {calendarUpdatedAt ? `NSE calendar updated: ${new Date(calendarUpdatedAt).toLocaleTimeString()}. ` : ""}
              Showing {rows.length} of {symbols.length} F&amp;O stocks. IV Rank/Percentile need at least 20 prior daily observations
              to be meaningful. Stale rows have not refreshed within the expected broker snapshot window. Events are announced only;
              no event badge cannot rule out unknown events.
            </p>
          </div>
        </div>
      </PageContainer>
    </DashboardLayout>
  );
}

function ScreenerRow({
  row,
  projectionDays,
  sigma,
  calendarStatus,
}: {
  row: IvUniverseSymbol;
  projectionDays: number;
  sigma: IvScreenerSigma;
  calendarStatus: CorporateCalendarStatus;
}) {
  const range = expectedIvRange(row.spot, row.atm_iv, projectionDays, sigma);
  const events = [...(row.events ?? [])].sort((left, right) => left.event_date.localeCompare(right.event_date));
  const nearestEvent = events[0];
  return (
    <tr className="border-b border-[var(--color-border-subtle)] last:border-0">
      <td className="px-4 py-3">
        <div className="font-bold text-[var(--color-text-primary)]">{row.symbol}</div>
        <div className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">{row.company_name}</div>
      </td>
      <td className="tnum px-4 py-3 text-right">
        {row.spot === null ? "—" : row.spot.toLocaleString(undefined, { maximumFractionDigits: 2 })}
      </td>
      <td className="tnum px-4 py-3 text-right font-bold">{percent(row.atm_iv)}</td>
      <td className="tnum px-4 py-3 text-right">{points(row.iv_rank)}</td>
      <td className="tnum px-4 py-3 text-right">{points(row.iv_percentile)}</td>
      <td className="tnum px-4 py-3 text-right">
        {range ? (
          <div>
            <div className="font-semibold text-[var(--color-text-primary)]">{inr(range.lower)} – {inr(range.upper)}</div>
            <div className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">±{inr(range.move)}</div>
          </div>
        ) : "—"}
      </td>
      <td className="px-4 py-3">
        {calendarStatus === "unavailable" ? (
          <span className="text-xs text-[var(--color-text-muted)]" title="Event feed unavailable—range not event-checked">Unknown</span>
        ) : calendarStatus === "stale" && events.length === 0 ? (
          <span className="text-xs text-[var(--color-accent-orange)]" title="Event calendar is stale—range not fully event-checked">Unknown</span>
        ) : nearestEvent ? (
          <details className="group">
            <summary className="cursor-pointer list-none">
              <Badge tone="orange">{eventLabel(nearestEvent.event_type)} · {eventDate(nearestEvent.event_date)}</Badge>
              {events.length > 1 && <span className="ml-1 text-[10px] text-[var(--color-text-muted)]">+{events.length - 1}</span>}
            </summary>
            <div className="mt-2 min-w-48 space-y-1 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] p-2 text-[10px] text-[var(--color-text-secondary)]">
              {events.map((event) => (
                <div key={`${event.event_type}-${event.event_date}-${event.title}`}>
                  <span className="font-semibold text-[var(--color-text-primary)]">{eventDate(event.event_date)} · {eventLabel(event.event_type)}</span>
                  <span className="block">{event.title}</span>
                </div>
              ))}
            </div>
          </details>
        ) : (
          <span className="text-xs text-[var(--color-text-muted)]">No announced events</span>
        )}
      </td>
      <td className="px-4 py-3">
        <Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge>
        {row.updated_at && <div className="mt-1 text-[10px] text-[var(--color-text-muted)]">Updated {new Date(row.updated_at).toLocaleTimeString()}</div>}
      </td>
    </tr>
  );
}
