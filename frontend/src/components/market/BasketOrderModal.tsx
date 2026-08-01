"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { BasketLegDraft, BasketRiskDraft, orderBasketLegsForMargin, serializeBasketForStrategy, validateBasketLeg } from "@/lib/basket";
import { getMarginRequirement, MarginResult } from "@/lib/market";
import { placeBasketOrder, ProductType } from "@/lib/orders";
import { createPaperOrder } from "@/lib/paperTrading";
import { formatINR } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { usePositionStore } from "@/stores/positionStore";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { ApiErrorDisplay } from "@/components/ui/ApiErrorDisplay";

interface Props {
  symbol: string;
  legs: BasketLegDraft[];
  risk: BasketRiskDraft;
  priceFor: (symbol: string) => number | null | undefined;
  onChange: (legs: BasketLegDraft[]) => void;
  onRiskChange: (risk: BasketRiskDraft) => void;
  onClose: () => void;
}

function optionalNumber(value: string): number | undefined {
  return value.trim() === "" ? undefined : Number(value);
}

export function BasketOrderModal({ symbol, legs, risk, priceFor, onChange, onRiskChange, onClose }: Props) {
  const { tradingMode, canTrade, sessionLive } = useAuth();
  const executePaperOrder = usePositionStore(state => state.executePaperOrder);
  const [productType, setProductType] = useState<ProductType>("INTRADAY");
  const [margin, setMargin] = useState<MarginResult | null>(null);
  const [marginError, setMarginError] = useState<unknown>(null);
  const [marginLoading, setMarginLoading] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const orderedLegs = useMemo(() => orderBasketLegsForMargin(legs), [legs]);
  const prices = useMemo(() => Object.fromEntries(orderedLegs.map(leg => [leg.instrument.trading_symbol, priceFor(leg.instrument.trading_symbol) || 0])), [orderedLegs, priceFor]);
  const legErrors = useMemo(() => orderedLegs.map(leg => validateBasketLeg(leg, prices[leg.instrument.trading_symbol])), [orderedLegs, prices]);
  const valid = orderedLegs.length > 0 && legErrors.every(error => error === null) &&
    (risk.combinedStopLoss == null || risk.combinedStopLoss > 0) &&
    (risk.combinedTarget == null || risk.combinedTarget > 0);

  const refreshMargin = useCallback(async () => {
    if (!orderedLegs.length) return;
    setMarginLoading(true);
    setMarginError(null);
    try {
      setMargin(await getMarginRequirement(orderedLegs.map(leg => ({
        symbol: leg.instrument.trading_symbol, quantity: leg.quantity, side: leg.side, product_type: productType,
      }))));
    } catch (error) {
      setMargin(null);
      setMarginError(error);
    } finally {
      setMarginLoading(false);
    }
  }, [orderedLegs, productType]);

  useEffect(() => {
    if (!valid) { setMargin(null); return; }
    const timeout = window.setTimeout(() => void refreshMargin(), 450);
    return () => window.clearTimeout(timeout);
  }, [refreshMargin, valid]);

  const updateLeg = (id: string, patch: Partial<BasketLegDraft>) => onChange(orderBasketLegsForMargin(orderedLegs.map(leg => leg.id === id ? { ...leg, ...patch } : leg)));
  const removeLeg = (id: string) => onChange(orderedLegs.filter(leg => leg.id !== id));

  const openStrategy = () => {
    const href = `/strategy?basket=${serializeBasketForStrategy(orderedLegs, prices)}`;
    const popup = window.open(href, "strategy-basket");
    if (!popup) window.location.assign(href);
  };

  const submitPaper = () => {
    try {
      const order = createPaperOrder(orderedLegs.map(leg => ({
        id: leg.id, instrument: leg.instrument, action: leg.side, quantity: leg.quantity, entryPrice: 0, iv: 0,
      })), priceFor);
      executePaperOrder({
        symbol,
        label: `${symbol} • Basket (${order.legs.length} legs)`,
        legs: order.legs,
        entryCost: order.entryCost,
        fills: order.fills,
        basketRisk: {
          legRisk: Object.fromEntries(orderedLegs.map(leg => [leg.id, { stopLoss: leg.stopLoss, targetPrice: leg.targetPrice }])),
          combinedStopLoss: risk.combinedStopLoss,
          combinedTarget: risk.combinedTarget,
        },
      });
      toast.success("Paper basket filled", { description: `${order.legs.length} legs are now protected while this app is open.` });
      onClose();
    } catch (error) {
      toast.error("Paper basket was not filled", { description: error instanceof Error ? error.message : "Unable to obtain a live premium." });
    }
  };

  const submitLive = async () => {
    setSubmitting(true);
    try {
      const response = await placeBasketOrder({
        legs: orderedLegs.map(leg => ({
          symbol: leg.instrument.trading_symbol, quantity: leg.quantity, side: leg.side,
          product_type: productType, order_type: "MARKET", limit_price: 0, stop_price: 0,
          validity: "DAY", disclosed_quantity: 0, offline_order: false,
          stop_loss: leg.stopLoss, target_price: leg.targetPrice,
        })),
        combined_stop_loss: risk.combinedStopLoss,
        combined_take_profit: risk.combinedTarget,
      });
      const submitted = response.legs.filter(leg => leg.status === "PendingEntry").length;
      toast.success("Basket submitted", { description: `${submitted}/${response.legs.length} legs accepted. Stops are armed after fill confirmation.` });
      onClose();
    } catch {
      toast.error("Basket was not submitted. Review your broker connection and margin.");
    } finally { setSubmitting(false); }
  };

  return <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-3 backdrop-blur-sm sm:p-6">
    <Card className="mx-auto my-4 w-full max-w-4xl">
      <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border-subtle)] pb-3">
        <div><h3 className="text-base font-bold text-[var(--color-text-bright)]">Option Chain Basket</h3><p className="mt-1 text-xs text-[var(--color-text-muted)]">Per-leg exits use option premium; combined exits use total ₹ P&amp;L.</p></div>
        <Button variant="icon" aria-label="Close basket" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>
      {!reviewing ? <div className="mt-4 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><label className="text-xs font-semibold text-[var(--color-text-secondary)]">Product <Select className="ml-2 inline-block w-32" value={productType} onChange={event => setProductType(event.target.value as ProductType)}><option value="INTRADAY">INTRADAY</option><option value="MARGIN">MARGIN</option><option value="CNC">CNC</option></Select></label><Button size="sm" variant="outline" onClick={openStrategy}>Analyze in Strategy Builder</Button></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="border-b border-[var(--color-border-default)] text-[var(--color-text-muted)]"><tr><th className="p-2">Contract</th><th className="p-2">Side</th><th className="p-2">Premium</th><th className="p-2">Qty</th><th className="p-2">Stop-loss</th><th className="p-2">Target</th><th></th></tr></thead><tbody>{orderedLegs.map((leg, index) => <tr key={leg.id} className="border-b border-[var(--color-border-subtle)] align-top"><td className="p-2 font-medium text-[var(--color-text-primary)]">{leg.instrument.strike} {leg.instrument.option_type}<p className="mt-1 max-w-40 truncate text-[10px] text-[var(--color-text-muted)]">{leg.instrument.trading_symbol}</p></td><td className="p-2"><Select value={leg.side} onChange={event => updateLeg(leg.id, { side: event.target.value as BasketLegDraft["side"] })}><option>Buy</option><option>Sell</option></Select></td><td className="tnum p-2">{prices[leg.instrument.trading_symbol] ? formatINR(prices[leg.instrument.trading_symbol]) : "—"}</td><td className="p-2"><Input className="w-24" type="number" min={leg.instrument.lot_size || 1} step={leg.instrument.lot_size || 1} value={leg.quantity} onChange={event => updateLeg(leg.id, { quantity: Number(event.target.value) })} /></td><td className="p-2"><Input className="w-24" aria-label={`Stop-loss ${index + 1}`} type="number" min="0" step="0.05" value={leg.stopLoss ?? ""} onChange={event => updateLeg(leg.id, { stopLoss: optionalNumber(event.target.value) })} /></td><td className="p-2"><Input className="w-24" aria-label={`Target ${index + 1}`} type="number" min="0" step="0.05" value={leg.targetPrice ?? ""} onChange={event => updateLeg(leg.id, { targetPrice: optionalNumber(event.target.value) })} />{legErrors[index] && <p className="mt-1 max-w-36 text-[10px] text-[var(--color-loss)]">{legErrors[index]}</p>}</td><td className="p-2"><Button variant="icon" aria-label={`Remove ${leg.instrument.trading_symbol}`} onClick={() => removeLeg(leg.id)}><Trash2 className="h-3.5 w-3.5" /></Button></td></tr>)}</tbody></table></div>
        <div className="grid gap-3 rounded-lg bg-[var(--color-bg-hover)] p-3 sm:grid-cols-2"><label className="text-xs font-semibold text-[var(--color-text-secondary)]">Combined stop-loss (₹)<Input className="mt-1" type="number" min="0" value={risk.combinedStopLoss ?? ""} onChange={event => onRiskChange({ ...risk, combinedStopLoss: optionalNumber(event.target.value) })} /></label><label className="text-xs font-semibold text-[var(--color-text-secondary)]">Combined target (₹)<Input className="mt-1" type="number" min="0" value={risk.combinedTarget ?? ""} onChange={event => onRiskChange({ ...risk, combinedTarget: optionalNumber(event.target.value) })} /></label></div>
        <div className="rounded-lg border border-[var(--color-border-default)] p-3"><div className="flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Basket margin</p><Button variant="ghost" size="sm" disabled={marginLoading} onClick={() => void refreshMargin()}>{marginLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Refresh"}</Button></div>{margin ? <div className="mt-2 grid grid-cols-2 gap-3 text-xs sm:grid-cols-5">{[["Total", margin.total_margin], ["SPAN", margin.span_margin], ["Exposure", margin.exposure_margin], ["Premium", margin.premium], ["Available", margin.available_margin]].map(([label, value]) => <div key={String(label)}><p className="text-[var(--color-text-muted)]">{label}</p><p className="tnum mt-1 font-bold text-[var(--color-text-primary)]">{typeof value === "number" ? formatINR(value) : "—"}</p></div>)}</div> : <p className="mt-2 text-xs text-[var(--color-text-muted)]">{marginLoading ? "Calculating…" : "Enter valid legs to calculate margin."}</p>}{marginError !== null && <ApiErrorDisplay error={marginError} className="mt-2" />}</div>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button>{tradingMode === "paper" ? <Button disabled={!valid} onClick={submitPaper}>Place paper basket</Button> : <Button disabled={!valid || !canTrade || !sessionLive} onClick={() => { setAcknowledged(false); setReviewing(true); }}>Review live basket</Button>}</div>
      </div> : <div className="mt-4 flex flex-col gap-4"><div className="flex gap-3 rounded-lg border border-[var(--color-accent-orange)]/40 bg-[var(--color-accent-orange)]/5 p-3"><AlertTriangle className="h-5 w-5 shrink-0 text-[var(--color-accent-orange)]" /><p className="text-xs text-[var(--color-text-secondary)]">This submits {legs.length} real market orders. Per-leg stops are broker orders after fills; targets and combined exits are monitored by the server.</p></div><label className="flex gap-2 text-xs text-[var(--color-text-primary)]"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />I have reviewed this real basket order.</label><div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setReviewing(false)}>Back</Button><Button variant="danger" disabled={!acknowledged || submitting} onClick={() => void submitLive()}>{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Submit basket</Button></div></div>}
    </Card>
  </div>;
}
