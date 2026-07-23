"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { InstrumentSelector } from "@/components/market/InstrumentSelector";
import { getInstruments } from "@/lib/market";
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
import { PageContainer } from "@/components/ui/PageContainer";
import { Bell, Trash2, CheckCircle2, Clock, Plus, Sparkles, Moon } from "lucide-react";

const UNDERLYING_SCOPED_METRICS: AlertMetric[] = ["Net GEX", "VWAP Breakout"];

export default function AlertsPage() {
  const { alerts, triggerLog, addAlert, removeAlert, clearTriggerLog } = useAlertStore();

  // Form State
  const [symbol, setSymbol] = useState<string>(() => useSettingsStore.getState().defaultSymbol);
  const [expiry, setExpiry] = useState<string | null>(null);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [selectedInstrumentToken, setSelectedInstrumentToken] = useState<string>("");

  const [metric, setMetric] = useState<AlertMetric>("Price");
  const [operator, setOperator] = useState<AlertOperator>(">");
  const [threshold, setThreshold] = useState<string>("");
  const [cooldownMinutes, setCooldownMinutes] = useState<number>(15);

  const isUnderlyingScoped = UNDERLYING_SCOPED_METRICS.includes(metric);

  useEffect(() => {
    let isMounted = true;
    async function fetchContracts() {
      try {
        const data = await getInstruments(symbol);
        if (isMounted) {
          setInstruments(data.instruments);
          const expiries = Array.from(
            new Set(data.instruments.map(i => i.expiry).filter((e): e is string => !!e))
          ).sort();
          if (expiries.length > 0) setExpiry(expiries[0]);
          setSelectedInstrumentToken(""); // Reset selection
        }
      } catch (err) {
        console.error("Failed to fetch instruments", err);
      }
    }
    fetchContracts();
    return () => { isMounted = false; };
  }, [symbol]);

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

  const handleAddAlert = () => {
    if (!threshold) return;

    // If it's a price alert, we can attach it to the underlying or a specific option
    let targetInst: Instrument | undefined;

    if (isUnderlyingScoped || (metric === "Price" && !selectedInstrumentToken)) {
      targetInst = buildUnderlyingInstrument();
    } else {
      targetInst = instruments.find(i => i.trading_symbol === selectedInstrumentToken);
    }

    if (!targetInst) return;

    addAlert({
      instrument: targetInst,
      metric,
      operator,
      threshold: Number(threshold),
      cooldownMinutes,
    });

    setThreshold("");
  };

  const handleApplyTemplate = (template: AlertTemplate) => {
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

    addAlert({
      instrument: targetInst,
      metric: template.metric,
      operator: template.operator,
      threshold: template.threshold,
      cooldownMinutes: template.cooldownMinutes,
    });

    toast.success(`Preset applied: ${template.label}`);
  };

  const activeAlerts = alerts.filter(a => a.status === "Active" || a.status === "Snoozed");

  return (
    <DashboardLayout>
      <PageContainer>
        <div>
          <h1 className="text-xl font-black tracking-tight text-[var(--color-text-bright)]">Alerts Dashboard</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Set conditional triggers for Price, IV, and Greeks.{" "}
            <span className="text-[var(--color-accent-blue)]">Alerts run in the background while this application is open.</span>
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
            onExpiryChange={setExpiry}
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

          <div className="grid grid-cols-1 gap-4 border-t border-[var(--color-border-subtle)] pt-4 md:grid-cols-12 md:items-end">
            <div className="md:col-span-3">
              <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">Contract</label>
              <Select
                value={selectedInstrumentToken}
                onChange={e => setSelectedInstrumentToken(e.target.value)}
                disabled={isUnderlyingScoped}
              >
                <option value="">{symbol} (Underlying{isUnderlyingScoped ? " / Chain" : ""})</option>
                {instruments.filter(i => i.expiry === expiry).map(i => (
                  <option key={i.trading_symbol} value={i.trading_symbol}>
                    {i.strike} {i.option_type}
                  </option>
                ))}
              </Select>
            </div>

            <div className="md:col-span-2">
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

            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">Condition</label>
              <Select value={operator} onChange={e => setOperator(e.target.value as AlertOperator)}>
                <option value=">">&gt;</option>
                <option value="<">&lt;</option>
                <option value=">=">&gt;=</option>
                <option value="<=">&lt;=</option>
              </Select>
            </div>

            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">Threshold</label>
              <Input
                type="number"
                value={threshold}
                onChange={e => setThreshold(e.target.value)}
                placeholder="Value"
              />
            </div>

            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">Cooldown</label>
              <Select value={cooldownMinutes} onChange={e => setCooldownMinutes(Number(e.target.value))}>
                {COOLDOWN_OPTIONS.map(opt => (
                  <option key={opt.minutes} value={opt.minutes}>{opt.label}</option>
                ))}
              </Select>
            </div>

            <div className="md:col-span-1">
              <Button onClick={handleAddAlert} disabled={!threshold} className="h-10 w-full" aria-label="Add alert">
                <Plus className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </Card>

        {/* Active Alerts List */}
        <Card className="flex flex-col gap-4">
          <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--color-text-bright)]">
            <Clock className="h-4 w-4 text-[var(--color-text-secondary)]" /> Active Alerts
          </h3>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-[var(--color-text-secondary)]">
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
                {activeAlerts.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <EmptyState title="No active alerts." />
                    </td>
                  </tr>
                ) : (
                  activeAlerts.map(alert => (
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
                        <Button variant="icon" onClick={() => removeAlert(alert.id)} aria-label="Remove alert">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
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
              <Button variant="ghost" size="sm" onClick={clearTriggerLog}>
                Clear History
              </Button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-[var(--color-text-secondary)]">
              <thead className="bg-[var(--color-bg-hover)] text-xs uppercase text-[var(--color-text-muted)]">
                <tr>
                  <th className="rounded-tl-lg px-4 py-3">Instrument</th>
                  <th className="px-4 py-3">Condition</th>
                  <th className="px-4 py-3">Value</th>
                  <th className="rounded-tr-lg px-4 py-3">Triggered At</th>
                </tr>
              </thead>
              <tbody>
                {triggerLog.length === 0 ? (
                  <tr>
                    <td colSpan={4}>
                      <EmptyState title="No triggered alerts history." />
                    </td>
                  </tr>
                ) : (
                  triggerLog.map(event => (
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
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </PageContainer>
    </DashboardLayout>
  );
}
