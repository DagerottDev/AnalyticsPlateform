"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Loader2, RefreshCw, Search } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ApiErrorDisplay } from "@/components/ui/ApiErrorDisplay";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { PageContainer } from "@/components/ui/PageContainer";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { getIvUniverse, type IvUniverseSymbol } from "@/lib/ivUniverse";
import { cn } from "@/lib/utils";

const REFRESH_INTERVAL_MS = 60_000;

type SortKey = "symbol" | "spot" | "atm_iv" | "iv_rank" | "iv_percentile";
type SortDir = "asc" | "desc";

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

export default function VolatilityScreenerPage() {
  const [symbols, setSymbols] = useState<IvUniverseSymbol[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("iv_rank");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getIvUniverse();
      setSymbols(response.symbols);
      setGeneratedAt(response.generated_at);
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  }, []);

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

  return (
    <DashboardLayout>
      <PageContainer>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <SectionHeader
            title="IV Screener"
            description="ATM implied volatility, IV Rank, and IV Percentile across every NSE F&O stock."
          />
          <Button variant="secondary" onClick={() => void refresh()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
          </Button>
        </div>

        <Card className="flex flex-col gap-3">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search symbol or company name…"
              className="pl-9"
            />
          </div>
          <p className="text-xs text-[var(--color-text-secondary)]">
            Backed by a scheduled backfill job, not live per-request broker calls — refreshes roughly every 30 minutes as the
            job progresses through the full F&O universe. Click a column header to sort.
          </p>
        </Card>

        {error !== null && <ApiErrorDisplay error={error} />}

        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-[var(--color-border-default)] bg-[var(--color-bg-hover)] text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
                <tr>
                  {COLUMNS.map((column) => (
                    <th
                      key={column.key}
                      className={cn(
                        "cursor-pointer select-none px-4 py-3 hover:text-[var(--color-text-primary)]",
                        column.align === "right" && "text-right"
                      )}
                      onClick={() => toggleSort(column.key)}
                    >
                      <span className={cn("inline-flex items-center gap-1", column.align === "right" && "flex-row-reverse")}>
                        {column.label}
                        {sortKey === column.key ? (
                          sortDir === "asc" ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : (
                            <ArrowDown className="h-3 w-3" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-30" />
                        )}
                      </span>
                    </th>
                  ))}
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <ScreenerRow key={row.symbol} row={row} />
                ))}
                {rows.length === 0 && !loading && (
                  <tr>
                    <td colSpan={COLUMNS.length + 1} className="px-4 py-8 text-center text-sm text-[var(--color-text-muted)]">
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
          Showing {rows.length} of {symbols.length} F&O stocks. IV Rank/Percentile need at least two daily observations to
          appear and show &quot;Building&quot; until then.
        </p>
      </PageContainer>
    </DashboardLayout>
  );
}

function ScreenerRow({ row }: { row: IvUniverseSymbol }) {
  const isReady = row.atm_iv !== null;
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
      <td className="px-4 py-3">
        <Badge tone={isReady ? "profit" : "orange"}>{isReady ? "Ready" : "Building"}</Badge>
      </td>
    </tr>
  );
}
