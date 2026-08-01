"use client";

import { useEffect, useState } from "react";
import { BellPlus, X } from "lucide-react";
import { ApiErrorDisplay } from "@/components/ui/ApiErrorDisplay";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useAlertStore, type AlertOperator } from "@/stores/alertStore";
import { GREEK_LABEL, METRIC_TO_ALERT } from "./greekLabels";
import type { GreekMetric } from "@/lib/strikeGreekAnalysis";
import type { Instrument } from "@/types/market";
import { useSettingsStore } from "@/stores/settingsStore";

interface CreateGreekAlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  instruments: Instrument[];
  /** Preselects the metric when opened from a specific chart card; left
   * unset when opened from the workspace header. */
  initialMetric?: GreekMetric;
}

function compactSymbol(symbol: string) {
  return symbol.length > 26 ? `${symbol.slice(0, 23)}…` : symbol;
}

const ALL_GREEKS = Object.keys(GREEK_LABEL) as GreekMetric[];

export function CreateGreekAlertModal({ isOpen, onClose, instruments, initialMetric }: CreateGreekAlertModalProps) {
  const defaultCooldownMinutes = useSettingsStore((state) => state.alerts.cooldownMinutes);
  const symbols = instruments.map((instrument) => instrument.trading_symbol);
  const { addAlert } = useAlertStore();

  const [metric, setMetric] = useState<GreekMetric>(initialMetric ?? "delta");
  const [focusSymbol, setFocusSymbol] = useState("");
  const [operator, setOperator] = useState<AlertOperator>(">");
  const [threshold, setThreshold] = useState("");
  const [cooldownMinutes, setCooldownMinutes] = useState(defaultCooldownMinutes);
  const [alertError, setAlertError] = useState<unknown>(null);
  const [alertMessage, setAlertMessage] = useState("");

  // Re-scope to whatever card the modal was opened from each time it opens.
  useEffect(() => {
    if (!isOpen) return;
    setMetric(initialMetric ?? "delta");
    setCooldownMinutes(defaultCooldownMinutes);
    setAlertError(null);
    setAlertMessage("");
  }, [isOpen, initialMetric, defaultCooldownMinutes]);

  if (!isOpen) return null;

  const selectedFocus = symbols.includes(focusSymbol) ? focusSymbol : (symbols[0] ?? "");

  const createAlert = async () => {
    const instrument = instruments.find((item) => item.trading_symbol === selectedFocus);
    const numericThreshold = Number(threshold);
    if (!instrument || !Number.isFinite(numericThreshold)) return;
    setAlertError(null);
    setAlertMessage("");
    try {
      await addAlert({
        instrument,
        metric: METRIC_TO_ALERT[metric],
        operator,
        threshold: numericThreshold,
        cooldownMinutes,
      });
      setAlertMessage(`${GREEK_LABEL[metric]} alert saved for ${compactSymbol(instrument.trading_symbol)}.`);
      setThreshold("");
    } catch (error) {
      setAlertError(error);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md rounded-2xl border border-[var(--color-border-accent)] bg-[var(--color-bg-surface)] p-6 shadow-2xl">
        <div className="flex items-start justify-between border-b border-[var(--color-border-subtle)] pb-4">
          <h3 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-[var(--color-text-bright)]">
            <BellPlus className="h-5 w-5 text-[var(--color-accent-blue)]" /> Create Greek alert
          </h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-bright)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-3 text-sm">
          <label className="flex flex-col gap-1 text-[var(--color-text-secondary)]">
            Greek
            <Select value={metric} onChange={(event) => setMetric(event.target.value as GreekMetric)}>
              {ALL_GREEKS.map((option) => <option key={option} value={option}>{GREEK_LABEL[option]}</option>)}
            </Select>
          </label>

          <label className="flex flex-col gap-1 text-[var(--color-text-secondary)]">
            Contract
            <Select value={selectedFocus} onChange={(event) => setFocusSymbol(event.target.value)}>
              {symbols.map((symbol) => <option key={symbol} value={symbol}>{compactSymbol(symbol)}</option>)}
            </Select>
          </label>

          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1 text-[var(--color-text-secondary)]">
              Condition
              <Select aria-label="Alert operator" value={operator} onChange={(event) => setOperator(event.target.value as AlertOperator)}>
                <option value=">">&gt;</option><option value="<">&lt;</option><option value=">=">≥</option><option value="<=">≤</option>
              </Select>
            </label>
            <label className="flex flex-1 flex-col gap-1 text-[var(--color-text-secondary)]">
              Threshold
              <Input aria-label="Alert threshold" type="number" step="any" value={threshold} onChange={(event) => setThreshold(event.target.value)} placeholder="0.00" />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-[var(--color-text-secondary)]">
              Cooldown (min)
              <Input aria-label="Alert cooldown" type="number" min="0" value={cooldownMinutes} onChange={(event) => setCooldownMinutes(Math.max(0, event.target.valueAsNumber || 0))} />
            </label>
          </div>

          {alertMessage && <p className="text-xs text-[var(--color-profit)]" role="status">{alertMessage}</p>}
          {alertError !== null && <ApiErrorDisplay error={alertError} />}
        </div>

        <div className="mt-6 flex justify-end gap-2 border-t border-[var(--color-border-subtle)] pt-4">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={createAlert} disabled={!threshold || !selectedFocus}>
            <BellPlus className="h-3.5 w-3.5" /> Create alert
          </Button>
        </div>
      </div>
    </div>
  );
}
