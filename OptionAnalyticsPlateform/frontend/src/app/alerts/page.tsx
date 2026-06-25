"use client";

import { useState, useEffect } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { InstrumentSelector } from "@/components/market/InstrumentSelector";
import { getInstruments } from "@/lib/market";
import { Instrument } from "@/types/market";
import { useAlertStore, AlertMetric, AlertOperator } from "@/stores/alertStore";
import { Bell, Trash2, CheckCircle2, Clock, Plus } from "lucide-react";

export default function AlertsPage() {
  const { alerts, addAlert, removeAlert, updateAlertStatus, clearTriggered } = useAlertStore();
  
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
          if (data.expiries.length > 0) setExpiry(data.expiries[0]);
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
        instrument_token: parseInt(Math.random().toString().substr(2, 6)),
        exchange_token: "0",
        tradingsymbol: symbol,
        name: symbol,
        expiry: "",
        strike: 0,
        tick_size: 0.05,
        lot_size: 1,
        instrument_type: "EQ",
        option_type: "",
        exchange: "NSE",
        trading_symbol: symbol
      };
    } else {
      targetInst = instruments.find(i => i.instrument_token.toString() === selectedInstrumentToken);
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
      <div className="flex flex-col gap-6 p-6 max-w-6xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-bright)]">Alerts Dashboard</h1>
          <p className="text-sm text-[var(--color-text-muted)]">Set conditional triggers for Price, IV, and Greeks. <span className="text-[var(--color-accent-blue)]">Alerts run in the background while this application is open.</span></p>
        </div>

        {/* Create Alert Form */}
        <div className="flex flex-col gap-4 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-6 shadow-sm">
          <h3 className="text-sm font-bold text-[var(--color-text-bright)] flex items-center gap-2">
            <Bell className="w-4 h-4 text-[var(--color-accent-blue)]" /> Create New Alert
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            <div className="md:col-span-3">
               <InstrumentSelector 
                 selectedSymbol={symbol} 
                 onSymbolChange={setSymbol} 
                 selectedExpiry={expiry} 
                 onExpiryChange={setExpiry} 
                 availableExpiries={Array.from(new Set(instruments.map(i => i.expiry))).sort()}
               />
            </div>
            
            <div className="md:col-span-3">
               <select 
                 className="w-full h-10 bg-[#18181b] text-sm text-[var(--color-text-primary)] rounded-md px-3 outline-none border border-[var(--color-border-subtle)]"
                 value={selectedInstrumentToken}
                 onChange={e => setSelectedInstrumentToken(e.target.value)}
               >
                 <option value="">{symbol} (Underlying)</option>
                 {instruments.filter(i => i.expiry === expiry).map(i => (
                   <option key={i.instrument_token} value={i.instrument_token}>
                     {i.strike} {i.option_type}
                   </option>
                 ))}
               </select>
            </div>

            <div className="md:col-span-2">
               <select 
                 className="w-full h-10 bg-[#18181b] text-sm text-[var(--color-text-primary)] rounded-md px-3 outline-none border border-[var(--color-border-subtle)]"
                 value={metric}
                 onChange={e => setMetric(e.target.value as AlertMetric)}
               >
                 <option value="Price">Price</option>
                 <option value="IV">IV (%)</option>
                 <option value="Delta">Delta</option>
                 <option value="Gamma">Gamma</option>
                 <option value="Theta">Theta</option>
                 <option value="Vega">Vega</option>
                 <option value="Call GEX">Call GEX</option>
                 <option value="Put GEX">Put GEX</option>
               </select>
            </div>

            <div className="md:col-span-1">
               <select 
                 className="w-full h-10 bg-[#18181b] text-sm text-[var(--color-text-primary)] rounded-md px-2 outline-none border border-[var(--color-border-subtle)]"
                 value={operator}
                 onChange={e => setOperator(e.target.value as AlertOperator)}
               >
                 <option value=">">&gt;</option>
                 <option value="<">&lt;</option>
                 <option value=">=">&gt;=</option>
                 <option value="<=">&lt;=</option>
               </select>
            </div>

            <div className="md:col-span-2">
               <input 
                 type="number"
                 className="w-full h-10 bg-[#18181b] text-sm text-[var(--color-text-primary)] rounded-md px-3 outline-none border border-[var(--color-border-subtle)]"
                 value={threshold}
                 onChange={e => setThreshold(e.target.value)}
                 placeholder="Threshold"
               />
            </div>

            <div className="md:col-span-1">
               <button 
                 onClick={handleAddAlert}
                 disabled={!threshold}
                 className="w-full h-10 flex items-center justify-center bg-[var(--color-accent-blue)] text-white rounded-md hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
               >
                 <Plus className="w-5 h-5" />
               </button>
            </div>
          </div>
        </div>

        {/* Active Alerts List */}
        <div className="flex flex-col gap-4 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-6 shadow-sm">
          <h3 className="text-sm font-bold text-[var(--color-text-bright)] flex items-center gap-2">
            <Clock className="w-4 h-4 text-[var(--color-text-secondary)]" /> Active Alerts
          </h3>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-[var(--color-text-secondary)]">
              <thead className="bg-[#18181b] text-xs uppercase text-[var(--color-text-muted)]">
                <tr>
                  <th className="px-4 py-3 rounded-tl-lg">Instrument</th>
                  <th className="px-4 py-3">Condition</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3 rounded-tr-lg">Action</th>
                </tr>
              </thead>
              <tbody>
                {activeAlerts.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center">No active alerts.</td>
                  </tr>
                ) : (
                  activeAlerts.map(alert => (
                    <tr key={alert.id} className="border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[#18181b]/50">
                      <td className="px-4 py-3 font-medium text-[var(--color-text-bright)]">{alert.instrument.trading_symbol}</td>
                      <td className="px-4 py-3">
                        <span className="text-[var(--color-accent-blue)]">{alert.metric}</span> {alert.operator} <span className="font-mono">{alert.threshold}</span>
                      </td>
                      <td className="px-4 py-3 text-xs">{new Date(alert.createdAt).toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => removeAlert(alert.id)} className="text-[var(--color-text-muted)] hover:text-[var(--color-accent-red)] transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Triggered Alerts History */}
        <div className="flex flex-col gap-4 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-[var(--color-text-bright)] flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[var(--color-accent-green)]" /> Triggered History
            </h3>
            {triggeredAlerts.length > 0 && (
              <button onClick={clearTriggered} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
                Clear History
              </button>
            )}
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-[var(--color-text-secondary)]">
              <thead className="bg-[#18181b] text-xs uppercase text-[var(--color-text-muted)]">
                <tr>
                  <th className="px-4 py-3 rounded-tl-lg">Instrument</th>
                  <th className="px-4 py-3">Condition</th>
                  <th className="px-4 py-3">Triggered At</th>
                </tr>
              </thead>
              <tbody>
                {triggeredAlerts.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center">No triggered alerts history.</td>
                  </tr>
                ) : (
                  triggeredAlerts.map(alert => (
                    <tr key={alert.id} className="border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[#18181b]/50">
                      <td className="px-4 py-3 font-medium text-[var(--color-text-bright)]">{alert.instrument.trading_symbol}</td>
                      <td className="px-4 py-3 opacity-75">
                        {alert.metric} {alert.operator} {alert.threshold}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--color-accent-green)]">
                        {alert.triggeredAt ? new Date(alert.triggeredAt).toLocaleString() : "-"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </DashboardLayout>
  );
}
