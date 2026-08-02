"use client";

import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { InstrumentSelector } from "@/components/market/InstrumentSelector";
import { getInstruments, getMarketQuotes } from "@/lib/market";
import { useMarketData } from "@/hooks/useMarketData";
import { latestExpiry } from "@/lib/expiry";
import { Instrument } from "@/types/market";
import { useAlertStore, AlertMetric, AlertOperator } from "@/stores/alertStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { ALERT_TEMPLATES, COOLDOWN_OPTIONS, AlertTemplate } from "@/lib/alertTemplates";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ApiErrorDisplay } from "@/components/ui/ApiErrorDisplay";
import { PageContainer } from "@/components/ui/PageContainer";
import { Bell, Trash2, CheckCircle2, Clock, Plus, Sparkles, Moon } from "lucide-react";
import { defaultSpotFallback, nearestStrikeTo } from "@/lib/optionMath";
import { formatStrikeWithPosition } from "@/lib/strikePositions";

const UNDERLYING_SCOPED_METRICS: AlertMetric[] = ["Net GEX", "VWAP Breakout"];

export default function AlertsPage() {
  const { alerts, triggerLog, addAlert, removeAlert, clearTriggerLog } = useAlertStore();
  const alertDefaults = useSettingsStore((state) => state.alerts);

  // Form State
  const [symbol, setSymbol] = useState<string>(() => useSettingsStore.getState().defaultSymbol);
  const [expiry, setExpiry] = useState<string | null>(null);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [selectedInstrumentToken, setSelectedInstrumentToken] = useState<string>("");
  const [snapshotSpot, setSnapshotSpot] = useState<number | null>(null);

  const [metric, setMetric] = useState<AlertMetric>(() => alertDefaults.metric);
  const [operator, setOperator] = useState<AlertOperator>(() => alertDefaults.operator);
  const [threshold, setThreshold] = useState<string>("");
  const [cooldownMinutes, setCooldownMinutes] = useState<number>(() => alertDefaults.cooldownMinutes);
  const [loadingInstruments, setLoadingInstruments] = useState<boolean>(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const { getTick } = useMarketData([symbol]);
  const underlyingTick = getTick(symbol);
  const spot = underlyingTick?.last_price && underlyingTick.last_price > 0
    ? underlyingTick.last_price
    : snapshotSpot ?? defaultSpotFallback(symbol);
  const expiryInstruments = useMemo(
    () => instruments.filter((instrument) => instrument.expiry === expiry),
    [expiry, instruments]
  );
  const expiryStrikes = useMemo(
    () => Array.from(new Set(expiryInstruments.flatMap((instrument) => (
      typeof instrument.strike === "number" ? [instrument.strike] : []
    )))).sort((left, right) => left - right),
    [expiryInstruments]
  );
  const atmStrike = useMemo(
    () => expiryStrikes.length > 0 ? nearestStrikeTo(expiryStrikes, spot) : null,
    [expiryStrikes, spot]
  );
  const orderedExpiryInstruments = useMemo(
    () => [...expiryInstruments].sort((left, right) => {
      const leftDistance = atmStrike === null || left.strike === null ? Number.POSITIVE_INFINITY : Math.abs(left.strike - atmStrike);
      const rightDistance = atmStrike === null || right.strike === null ? Number.POSITIVE_INFINITY : Math.abs(right.strike - atmStrike);
      if (leftDistance !== rightDistance) return leftDistance - rightDistance;
      if (left.strike !== right.strike) return (left.strike ?? Number.POSITIVE_INFINITY) - (right.strike ?? Number.POSITIVE_INFINITY);
      return (left.option_type ?? "").localeCompare(right.option_type ?? "");
    }),
    [atmStrike, expiryInstruments]
  );

  const isUnderlyingScoped = UNDERLYING_SCOPED_METRICS.includes(metric);

  useEffect(() => {
    let isMounted = true;
    async function fetchContracts() {
      setLoadingInstruments(true);
      setError(null);
      try {
        const data = await getInstruments(symbol);
        if (isMounted) {
          setInstruments(data.instruments);
          const defaultExpiry = latestExpiry(
            data.instruments.map((instrument) => instrument.expiry).filter((value): value is string => !!value)
          );
          if (defaultExpiry) setExpiry(defaultExpiry);
          setSelectedInstrumentToken(""); // Reset selection
        }
      } catch (cause) {
        if (isMounted) setError(cause);
      } finally {
        if (isMounted) setLoadingInstruments(false);
      }
    }
    fetchContracts();
    return () => { isMounted = false; };
  }, [symbol]);

  // Keep the strike labels useful after hours too. The live tick wins during
  // the session; outside it, previous close is a safer ATM reference than a
  // hardcoded index fallback.
  useEffect(() => {
    let isMounted = true;
    setSnapshotSpot(null);

    async function fetchSnapshotSpot() {
      try {
        const { quotes } = await getMarketQuotes([symbol]);
        const quote = quotes.find((item) => item.trading_symbol === symbol) ?? quotes[0];
        const candidate = [quote?.prev_close_price, quote?.last_price].find((value): value is number => (
          typeof value === "number" && Number.isFinite(value) && value > 0
        ));
        if (isMounted && candidate !== undefined) setSnapshotSpot(candidate);
      } catch {
        // Alerts remain usable with the symbol-specific fallback.
      }
    }

    void fetchSnapshotSpot();
    return () => {
      isMounted = false;
    };
  }, [symbol]);

  const handleExpiryChange = (nextExpiry: string) => {
    setExpiry(nextExpiry);
    setSelectedInstrumentToken("");
  };

  // Net GEX / VWAP Breakout apply to the whole underlying/chain, not a single contract
  useEffect(() => {
    if (isUnderlyingScoped) setSelectedInstrumentToken("");
  }, [isUnderlyingScoped]);

  function buildUnderlyingInstrument(): Instrument {
    return {
      trading_symbol: symbol,
      symbol: symbol,
      instrument_type: "EQ",
      expiry: metric === "Net GEX" ? expiry : null,
      strike: null,
      option_type: null,
      exchange: "NSE",
    };
  }

  const handleAddAlert = async () => {
    if (!threshold || !Number.isFinite(Number(threshold))) {
      toast.error("Enter a numeric threshold before creating an alert.");
      return;
    }

    // If it's a price alert, we can attach it to the underlying or a specific option
    let targetInst: Instrument | undefined;

    if (isUnderlyingScoped || (metric === "Price" && !selectedInstrumentToken)) {
      targetInst = buildUnderlyingInstrument();
    } else {
      targetInst = instruments.find(i => i.trading_symbol === selectedInstrumentToken);
    }

    if (!targetInst) {
      toast.error("Select a valid contract or use the underlying instrument.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await addAlert({ instrument: targetInst, metric, operator, threshold: Number(threshold), cooldownMinutes });
      setThreshold("");
      toast.success("Server-side alert created");
    } catch (cause) {
      setError(cause);
      toast.error("Could not save alert to the server.");
    } finally {
      setSaving(false);
    }
  };

  const handleApplyTemplate = async (template: AlertTemplate) => {
    let targetInst: Instrument | undefined;

    if (template.requiresContract) {
      targetInst = instruments.find(i => i.trading_symbol === selectedInstrumentToken);
      if (!targetInst) {
        toast.error(`Select an option contract first to use "${template.label}".`);
        return;
      }
    } else {
      targetInst = {
        trading_symbol: symbol,
        symbol: symbol,
        instrument_type: "EQ",
        expiry: template.metric === "Net GEX" ? expiry : null,
        strike: null,
        option_type: null,
        exchange: "NSE",
      };
      if (template.metric === "Net GEX" && !expiry) {
        toast.error(`Select an expiry first to use "${template.label}".`);
        return;
      }
    }

    setSaving(true);
    setError(null);
    try {
      await addAlert({ instrument: targetInst, metric: template.metric, operator: template.operator, threshold: template.threshold, cooldownMinutes: template.cooldownMinutes });
      toast.success(`Server-side preset applied: ${template.label}`);
    } catch (cause) {
      setError(cause);
      toast.error("Could not save alert to the server.");
    } finally {
      setSaving(false);
    }
  };

  const activeAlerts = alerts.filter(a => a.status === "Active" || a.status === "Snoozed");

  return (
    <DashboardLayout>
      <PageContainer>
        <div>
          <h1 className="text-xl font-black tracking-tight text-[var(--color-text-bright)]">Alerts Dashboard</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Set conditional triggers for Price, IV, and Greeks.{" "}
            <span className="text-[var(--color-accent-blue)]">Alerts are evaluated on the server, even when this tab is closed.</span>
          </p>
        </div>

        {/* Create Alert Form */}
        <Card className="flex flex-col gap-4">
          <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--color-text-bright)]">
            <Bell className="h-4 w-4 text-[var(--color-accent-blue)]" /> Create New Alert
          </h3>

          <InstrumentSelector
            symbol={symbol}
            onSymbolChange={setSymbol}
            expiry={expiry}
            onExpiryChange={handleExpiryChange}
          />

          {/* One-click presets */}
          <div className="flex flex-col gap-2 border-t border-[var(--color-border-subtle)] pt-4">
            <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-muted)]">
              <Sparkles className="h-3.5 w-3.5" /> Quick Presets
            </label>
            <div className="flex flex-wrap gap-2">
              {ALERT_TEMPLATES.map(template => {
                const disabled = template.requiresContract && !selectedInstrumentToken;
                return (
                  <Button
                    key={template.id}
                    variant="outline"
                    size="sm"
                    onClick={() => handleApplyTemplate(template)}
                    disabled={disabled}
                    title={disabled ? "Select an option contract below first" : template.description}
                  >
                    {template.label}
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 border-t border-[var(--color-border-subtle)] pt-4 sm:grid-cols-2 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-3">
              <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">Contract</label>
              <Select
                value={selectedInstrumentToken}
                onChange={e => setSelectedInstrumentToken(e.target.value)}
                disabled={isUnderlyingScoped}
              >
                <option value="">{symbol} (Underlying{isUnderlyingScoped ? " / Chain" : ""})</option>
                {orderedExpiryInstruments.map(i => (
                  <option key={i.trading_symbol} value={i.trading_symbol} aria-label={i.strike == null ? i.trading_symbol : i.strike.toLocaleString("en-IN")}>
                    {i.strike == null
                      ? `${i.option_type ?? "Option"} · position unavailable`
                      : `${formatStrikeWithPosition(i.strike, expiryStrikes, spot, i.option_type ?? "BOTH")} · ${i.option_type ?? "Option"}`}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                ATM: {atmStrike === null ? "—" : atmStrike.toLocaleString("en-IN")} · spot {spot.toLocaleString("en-IN")}
              </p>
            </div>

            <div className="lg:col-span-2">
              <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">Metric</label>
              <Select value={metric} onChange={e => setMetric(e.target.value as AlertMetric)}>
                <option value="Price">Price</option>
                <option value="IV">IV (%)</option>
                <option value="Delta">Delta</option>
                <option value="Gamma">Gamma</option>
                <option value="Theta">Theta</option>
                <option value="Vega">Vega</option>
                <option value="Call GEX">Call GEX</option>
                <option value="Put GEX">Put GEX</option>
                <option value="Net GEX">Net GEX (Chain)</option>
                <option value="VWAP Breakout">Price vs VWAP</option>
              </Select>
            </div>

            <div className="lg:col-span-2">
              <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">Condition</label>
              <Select value={operator} onChange={e => setOperator(e.target.value as AlertOperator)}>
                <option value=">">&gt;</option>
                <option value="<">&lt;</option>
                <option value=">=">&gt;=</option>
                <option value="<=">&lt;=</option>
              </Select>
            </div>

            <div className="lg:col-span-2">
              <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">Threshold</label>
              <Input
                type="number"
                value={threshold}
                onChange={e => setThreshold(e.target.value)}
                placeholder="Value"
              />
            </div>

            <div className="lg:col-span-2">
              <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">Cooldown</label>
              <Select value={cooldownMinutes} onChange={e => setCooldownMinutes(Number(e.target.value))}>
                {COOLDOWN_OPTIONS.map(opt => (
                  <option key={opt.minutes} value={opt.minutes}>{opt.label}</option>
                ))}
              </Select>
            </div>

            <div className="sm:col-span-2 lg:col-span-1">
              <Button onClick={handleAddAlert} disabled={!threshold || saving || loadingInstruments} className="h-10 w-full" aria-label="Add alert">
                <Plus className="h-5 w-5" />
                <span className="lg:hidden">Create Alert</span>
              </Button>
            </div>
          </div>
        </Card>

        {Boolean(loadingInstruments) && <p className="text-xs text-[var(--color-text-muted)]">Loading contracts for {symbol}…</p>}
        {error ? <ApiErrorDisplay error={error} /> : null}

        {/* Active Alerts List */}
        <Card className="flex flex-col gap-4">
          <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--color-text-bright)]">
            <Clock className="h-4 w-4 text-[var(--color-text-secondary)]" /> Active Alerts
          </h3>

          {activeAlerts.length === 0 ? (
            <EmptyState title="No active alerts." />
          ) : (
            <div className="divide-y divide-[var(--color-border-subtle)] lg:hidden">
              {activeAlerts.map((alert) => (
                <article key={alert.id} className="py-3 first:pt-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[var(--color-text-bright)]">{alert.instrument.trading_symbol}</p>
                      <p className="tnum mt-1 text-xs text-[var(--color-text-secondary)]">
                        <span className="text-[var(--color-accent-blue)]">{alert.metric}</span> {alert.operator} <span className="font-mono">{alert.threshold}</span>
                      </p>
                    </div>
                    <Button variant="icon" onClick={() => void removeAlert(alert.id)} aria-label={`Remove ${alert.instrument.trading_symbol} alert`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] text-[var(--color-text-muted)]">
                    <span>{alert.cooldownMinutes > 0 ? `Cooldown ${alert.cooldownMinutes}m` : "Fire once"}</span>
                    {alert.status === "Snoozed" ? (
                      <Badge tone="orange" title={alert.snoozedUntil ? `Rearms at ${new Date(alert.snoozedUntil).toLocaleTimeString()}` : undefined}>
                        <Moon className="h-2.5 w-2.5" /> Snoozed
                      </Badge>
                    ) : <Badge tone="profit">Live</Badge>}
                    <span className="tnum">{new Date(alert.createdAt).toLocaleString()}</span>
                  </div>
                </article>
              ))}
            </div>
          )}

          <div className="hidden overflow-x-auto lg:block">
            <table className="min-w-[700px] w-full text-left text-sm text-[var(--color-text-secondary)]">
              <thead className="bg-[var(--color-bg-hover)] text-xs uppercase text-[var(--color-text-muted)]">
                <tr>
                  <th className="rounded-tl-lg px-4 py-3">Instrument</th>
                  <th className="px-4 py-3">Condition</th>
                  <th className="px-4 py-3">Cooldown</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="rounded-tr-lg px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {activeAlerts.map(alert => (
                    <tr key={alert.id} className="border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[var(--color-bg-hover)]">
                      <td className="px-4 py-3 font-medium text-[var(--color-text-bright)]">{alert.instrument.trading_symbol}</td>
                      <td className="tnum px-4 py-3">
                        <span className="text-[var(--color-accent-blue)]">{alert.metric}</span> {alert.operator} <span className="font-mono">{alert.threshold}</span>
                      </td>
                      <td className="tnum px-4 py-3 text-xs">
                        {alert.cooldownMinutes > 0 ? `${alert.cooldownMinutes}m` : "Fire once"}
                      </td>
                      <td className="px-4 py-3">
                        {alert.status === "Snoozed" ? (
                          <Badge tone="orange" title={alert.snoozedUntil ? `Rearms at ${new Date(alert.snoozedUntil).toLocaleTimeString()}` : undefined}>
                            <Moon className="h-2.5 w-2.5" /> Snoozed
                          </Badge>
                        ) : (
                          <Badge tone="profit">Live</Badge>
                        )}
                      </td>
                      <td className="tnum px-4 py-3 text-xs">{new Date(alert.createdAt).toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <Button variant="icon" onClick={() => void removeAlert(alert.id)} aria-label="Remove alert">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Triggered Alerts History */}
        <Card className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--color-text-bright)]">
              <CheckCircle2 className="h-4 w-4 text-[var(--color-status-good)]" /> Triggered History
            </h3>
            {triggerLog.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => void clearTriggerLog()}>
                Clear History
              </Button>
            )}
          </div>

          {triggerLog.length === 0 ? (
            <EmptyState title="No triggered alerts history." />
          ) : (
            <div className="divide-y divide-[var(--color-border-subtle)] lg:hidden">
              {triggerLog.map((event) => (
                <article key={event.id} className="py-3 first:pt-0">
                  <p className="text-sm font-semibold text-[var(--color-text-bright)]">{event.tradingSymbol}</p>
                  <p className="tnum mt-1 text-xs text-[var(--color-text-secondary)]">{event.metric} {event.operator} {event.threshold}</p>
                  <div className="mt-3 flex items-center justify-between gap-3 text-[11px]">
                    <span className="tnum font-mono text-[var(--color-text-primary)]">Value {event.value.toFixed(4)}</span>
                    <span className="tnum text-right text-[var(--color-status-good)]">{new Date(event.triggeredAt).toLocaleString()}</span>
                  </div>
                </article>
              ))}
            </div>
          )}

          <div className="hidden overflow-x-auto lg:block">
            <table className="min-w-[620px] w-full text-left text-sm text-[var(--color-text-secondary)]">
              <thead className="bg-[var(--color-bg-hover)] text-xs uppercase text-[var(--color-text-muted)]">
                <tr>
                  <th className="rounded-tl-lg px-4 py-3">Instrument</th>
                  <th className="px-4 py-3">Condition</th>
                  <th className="px-4 py-3">Value</th>
                  <th className="rounded-tr-lg px-4 py-3">Triggered At</th>
                </tr>
              </thead>
              <tbody>
                {triggerLog.map(event => (
                    <tr key={event.id} className="border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[var(--color-bg-hover)]">
                      <td className="px-4 py-3 font-medium text-[var(--color-text-bright)]">{event.tradingSymbol}</td>
                      <td className="tnum px-4 py-3 opacity-75">
                        {event.metric} {event.operator} {event.threshold}
                      </td>
                      <td className="tnum px-4 py-3 font-mono text-xs">{event.value.toFixed(4)}</td>
                      <td className="tnum px-4 py-3 text-xs text-[var(--color-status-good)]">
                        {new Date(event.triggeredAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      </PageContainer>
    </DashboardLayout>
  );
}
