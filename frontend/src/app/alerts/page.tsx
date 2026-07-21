"use client";

import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { InstrumentSelector } from "@/components/market/InstrumentSelector";
import { getInstruments } from "@/lib/market";
import { Instrument } from "@/types/market";
import { useAlertStore, AlertMetric, AlertOperator } from "@/stores/alertStore";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageContainer } from "@/components/ui/PageContainer";
import { Bell, Trash2, CheckCircle2, Clock, Plus } from "lucide-react";

export default function AlertsPage() {
  const { alerts, addAlert, removeAlert, clearTriggered } = useAlertStore();

  // Form State
  const [symbol, setSymbol] = useState<string>("NIFTY");
  const [expiry, setExpiry] = useState<string | null>(null);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [selectedInstrumentToken, setSelectedInstrumentToken] = useState<string>("");

  const [metric, setMetric] = useState<AlertMetric>("Price");
  const [operator, setOperator] = useState<AlertOperator>(">");
  const [threshold, setThreshold] = useState<string>("");

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

  const handleAddAlert = () => {
    if (!threshold) return;

    // If it's a price alert, we can attach it to the underlying or a specific option
    let targetInst: Instrument | undefined;

    if (metric === "Price" && !selectedInstrumentToken) {
      // Find underlying instrument object (mock it if not in list, usually we only get options back)
      targetInst = {
        trading_symbol: symbol,
        symbol: symbol,
        instrument_type: "EQ",
        expiry: null,
        strike: null,
        option_type: null,
        exchange: "NSE",
      };
    } else {
      targetInst = instruments.find(i => i.trading_symbol === selectedInstrumentToken);
    }

    if (!targetInst) return;

    addAlert({
      instrument: targetInst,
      metric,
      operator,
      threshold: Number(threshold)
    });

    setThreshold("");
  };

  const activeAlerts = alerts.filter(a => a.status === "Active");
  const triggeredAlerts = alerts.filter(a => a.status === "Triggered");

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

          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="md:col-span-3">
               <InstrumentSelector
                 symbol={symbol}
                 onSymbolChange={setSymbol}
                 expiry={expiry}
                 onExpiryChange={setExpiry}
               />
            </div>

            <div className="md:col-span-3">
               <Select value={selectedInstrumentToken} onChange={e => setSelectedInstrumentToken(e.target.value)}>
                 <option value="">{symbol} (Underlying)</option>
                 {instruments.filter(i => i.expiry === expiry).map(i => (
                   <option key={i.trading_symbol} value={i.trading_symbol}>
                     {i.strike} {i.option_type}
                   </option>
                 ))}
               </Select>
            </div>

            <div className="md:col-span-2">
               <Select value={metric} onChange={e => setMetric(e.target.value as AlertMetric)}>
                 <option value="Price">Price</option>
                 <option value="IV">IV (%)</option>
                 <option value="Delta">Delta</option>
                 <option value="Gamma">Gamma</option>
                 <option value="Theta">Theta</option>
                 <option value="Vega">Vega</option>
                 <option value="Call GEX">Call GEX</option>
                 <option value="Put GEX">Put GEX</option>
               </Select>
            </div>

            <div className="md:col-span-1">
               <Select value={operator} onChange={e => setOperator(e.target.value as AlertOperator)}>
                 <option value=">">&gt;</option>
                 <option value="<">&lt;</option>
                 <option value=">=">&gt;=</option>
                 <option value="<=">&lt;=</option>
               </Select>
            </div>

            <div className="md:col-span-2">
               <Input
                 type="number"
                 value={threshold}
                 onChange={e => setThreshold(e.target.value)}
                 placeholder="Threshold"
               />
            </div>

            <div className="md:col-span-1">
               <Button onClick={handleAddAlert} disabled={!threshold} className="h-10 w-full">
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
                  <th className="px-4 py-3">Created</th>
                  <th className="rounded-tr-lg px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {activeAlerts.length === 0 ? (
                  <tr>
                    <td colSpan={4}>
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
            {triggeredAlerts.length > 0 && (
              <Button variant="ghost" size="sm" onClick={clearTriggered}>
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
                  <th className="rounded-tr-lg px-4 py-3">Triggered At</th>
                </tr>
              </thead>
              <tbody>
                {triggeredAlerts.length === 0 ? (
                  <tr>
                    <td colSpan={3}>
                      <EmptyState title="No triggered alerts history." />
                    </td>
                  </tr>
                ) : (
                  triggeredAlerts.map(alert => (
                    <tr key={alert.id} className="border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[var(--color-bg-hover)]">
                      <td className="px-4 py-3 font-medium text-[var(--color-text-bright)]">{alert.instrument.trading_symbol}</td>
                      <td className="tnum px-4 py-3 opacity-75">
                        {alert.metric} {alert.operator} {alert.threshold}
                      </td>
                      <td className="tnum px-4 py-3 text-xs text-[var(--color-status-good)]">
                        {alert.triggeredAt ? new Date(alert.triggeredAt).toLocaleString() : "-"}
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
