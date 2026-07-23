import { AlertMetric, AlertOperator } from "@/stores/alertStore";

export interface AlertTemplate {
  id: string;
  label: string;
  description: string;
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: number;
  cooldownMinutes: number;
  /** True if this preset needs a specific option contract selected in the form; false if it applies to the underlying/chain. */
  requiresContract: boolean;
}

export const ALERT_TEMPLATES: AlertTemplate[] = [
  {
    id: "iv-spike",
    label: "IV Spike > 20%",
    description: "Fires when the selected contract's implied volatility rises above 20%.",
    metric: "IV",
    operator: ">",
    threshold: 20,
    cooldownMinutes: 15,
    requiresContract: true,
  },
  {
    id: "gex-flip-negative",
    label: "GEX Flips Negative",
    description: "Fires when net dealer gamma exposure across the selected expiry's chain turns negative.",
    metric: "Net GEX",
    operator: "<",
    threshold: 0,
    cooldownMinutes: 30,
    requiresContract: false,
  },
  {
    id: "vwap-breakout",
    label: "Breakout Above VWAP",
    description: "Fires when the underlying's last price crosses above its volume-weighted average price.",
    metric: "VWAP Breakout",
    operator: ">",
    threshold: 0,
    cooldownMinutes: 15,
    requiresContract: false,
  },
];

export const COOLDOWN_OPTIONS: { label: string; minutes: number }[] = [
  { label: "Off (fire once)", minutes: 0 },
  { label: "5 min", minutes: 5 },
  { label: "15 min", minutes: 15 },
  { label: "30 min", minutes: 30 },
  { label: "1 hour", minutes: 60 },
  { label: "4 hours", minutes: 240 },
];
