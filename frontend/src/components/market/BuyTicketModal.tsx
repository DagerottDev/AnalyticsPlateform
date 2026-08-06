"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useAuth } from "@/hooks/useAuth";
import { createPaperOrder } from "@/lib/paperTrading";
import { createGttOrder, placeOrder } from "@/lib/orders";
import { formatINR } from "@/lib/utils";
import { usePositionStore } from "@/stores/positionStore";
import { Instrument, MarketTick } from "@/types/market";
import { getMarginRequirement, MarginResult } from "@/lib/market";
import { formatIstDatetimeLocal, parseIstDatetimeLocal } from "@/lib/marketSession";
import { ApiErrorDisplay } from "@/components/ui/ApiErrorDisplay";
import { EducationPopover } from "@/components/ui/EducationPopover";
import { useSettingsStore } from "@/stores/settingsStore";
import { usePaperGttStore } from "@/stores/paperGttStore";

type OrderType = "MARKET" | "LIMIT" | "GTT";
type OrderSide = "Buy" | "Sell";
type ProductType = "INTRADAY" | "CNC" | "MARGIN";

interface BuyTicketModalProps {
  symbol: string;
  instrument: Instrument;
  tick: MarketTick | null;
  onClose: () => void;
  initialSide?: OrderSide;
}

export function BuyTicketModal({ symbol, instrument, tick, onClose, initialSide = "Buy" }: BuyTicketModalProps) {
  const { tradingMode, canTrade, sessionLive } = useAuth();
  const executePaperOrder = usePositionStore((state) => state.executePaperOrder);
  const defaultGttValidityDays = useSettingsStore((state) => state.defaultGttValidityDays);
  const addPaperGtt = usePaperGttStore((state) => state.add);

  // Sourced live from the broker's symbol master (see backend's
  // lot_size_store) via the instrument this modal was opened for, not a
  // hardcoded per-symbol table.
  const lotSize = instrument.lot_size ?? 0;
  const ltp = tick?.last_price ?? 0;

  const [quantity, setQuantity] = useState(lotSize);
  const [side, setSide] = useState<OrderSide>(initialSide);
  const [orderType, setOrderType] = useState<OrderType>("MARKET");
  const [productType, setProductType] = useState<ProductType>("INTRADAY");
  const [limitPrice, setLimitPrice] = useState(ltp);
  const [stopLoss, setStopLoss] = useState(0);
  const [targetPrice, setTargetPrice] = useState(0);
  const [gttTriggerPrice, setGttTriggerPrice] = useState(0);
  const [gttExecutionType, setGttExecutionType] = useState<"MARKET" | "LIMIT">("MARKET");
  const [gttExpiry, setGttExpiry] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [margin, setMargin] = useState<MarginResult | null>(null);
  const [marginLoading, setMarginLoading] = useState(false);
  const [marginError, setMarginError] = useState<unknown>(null);
  const ticketKey = `${instrument.trading_symbol}:${initialSide}`;
  const previousTicketKey = useRef(ticketKey);

  const isPaper = tradingMode === "paper";
  const isGtt = orderType === "GTT";
  const entryReference = orderType === "LIMIT" ? limitPrice : ltp;
  const stopLossValid = stopLoss <= 0 || (entryReference > 0 && (side === "Buy" ? stopLoss < entryReference : stopLoss > entryReference));
  const targetValid = targetPrice <= 0 || (entryReference > 0 && (side === "Buy" ? targetPrice > entryReference : targetPrice < entryReference));
  const isValid =
    quantity > 0 && (lotSize <= 0 || quantity % lotSize === 0) &&
    (orderType !== "LIMIT" || limitPrice > 0) && (!isGtt || (gttTriggerPrice > 0 && parseIstDatetimeLocal(gttExpiry).getTime() > Date.now() && (gttExecutionType !== "LIMIT" || limitPrice > 0) && (side === "Buy" ? gttTriggerPrice > ltp : gttTriggerPrice < ltp))) && stopLossValid && targetValid;
  const riskError = !stopLossValid
    ? `${side} stop-loss must be ${side === "Buy" ? "below" : "above"} the entry premium.`
    : !targetValid
      ? `${side} target must be ${side === "Buy" ? "above" : "below"} the entry premium.`
      : null;

  useEffect(() => {
    if (!isGtt || gttExpiry) return;
    const target = new Date(Date.now() + defaultGttValidityDays * 86_400_000);
    setGttExpiry(formatIstDatetimeLocal(target));
  }, [defaultGttValidityDays, gttExpiry, isGtt]);

  const refreshMargin = useCallback(async () => {
    if (isPaper || !isValid) return;
    setMarginLoading(true);
    setMarginError(null);
    try {
      setMargin(await getMarginRequirement([{
        symbol: instrument.trading_symbol,
        quantity,
        side,
        product_type: productType,
      }]));
    } catch (error) {
      setMargin(null);
      setMarginError(error);
    } finally {
      setMarginLoading(false);
    }
  }, [instrument.trading_symbol, isPaper, isValid, productType, quantity, side]);

  useEffect(() => {
    if (isPaper || !isValid) {
      setMargin(null);
      setMarginError(null);
      return;
    }
    const timeout = window.setTimeout(() => void refreshMargin(), 350);
    return () => window.clearTimeout(timeout);
  }, [isPaper, isValid, refreshMargin]);

  useEffect(() => {
    if (orderType === "LIMIT" && limitPrice <= 0 && ltp > 0) setLimitPrice(ltp);
  }, [limitPrice, ltp, orderType]);

  // The drawer stays mounted while the user can continue browsing the chain.
  // Reset ticket-specific values when a different contract or entry-side
  // shortcut is selected so an old limit/risk value cannot leak into it.
  useEffect(() => {
    if (previousTicketKey.current === ticketKey) return;
    previousTicketKey.current = ticketKey;
    setSide(initialSide);
    setQuantity(lotSize);
    setOrderType("MARKET");
    setProductType("INTRADAY");
    setLimitPrice(ltp);
    setStopLoss(0);
    setTargetPrice(0);
    setGttTriggerPrice(0);
    setGttExecutionType("MARKET");
    setGttExpiry("");
    setReviewing(false);
    setAcknowledged(false);
    setSubmitting(false);
    setMargin(null);
    setMarginError(null);
  }, [initialSide, instrument.trading_symbol, lotSize, ltp, ticketKey]);

  const submitPaperOrder = () => {
    try {
      if (ltp <= 0) throw new Error("A live price is not available.");
      if (isGtt) {
        addPaperGtt({ symbol: instrument.trading_symbol, instrument, side, quantity, triggerPrice: gttTriggerPrice, executionType: gttExecutionType, limitPrice: gttExecutionType === "LIMIT" ? limitPrice : 0, expiresAt: parseIstDatetimeLocal(gttExpiry).toISOString() });
        toast.success("Paper GTT scheduled", { description: "It remains active while this app is open and receiving prices." }); onClose(); return;
      }
      if (orderType === "LIMIT") {
        const limitWouldFill = side === "Buy" ? limitPrice <= ltp : limitPrice >= ltp;
        if (!limitWouldFill) {
          toast.info("Paper limit order is pending", {
            description: `${side} limit orders fill only when the market reaches ${formatINR(limitPrice)}.`,
          });
          return;
        }
      }
      const legId = `quick-${side.toLowerCase()}-${Date.now()}`;
      const fillPrice = orderType === "LIMIT" ? limitPrice : ltp;
      const order = createPaperOrder(
        [{ id: legId, instrument, action: side, quantity, entryPrice: 0, iv: 0 }],
        () => fillPrice
      );
      executePaperOrder({
        symbol,
        label: `${instrument.trading_symbol} • Quick ${side.toLowerCase()}`,
        legs: order.legs,
        entryCost: order.entryCost,
        fills: order.fills,
        basketRisk: {
          legRisk: { [legId]: {
            stopLoss: stopLoss > 0 ? stopLoss : undefined,
            targetPrice: targetPrice > 0 ? targetPrice : undefined,
          } },
        },
      });
      toast.success(`Paper ${side.toLowerCase()} filled`, {
        description: `${quantity} qty of ${instrument.trading_symbol} at ${formatINR(order.fills[0].price)}`,
      });
      onClose();
    } catch (cause) {
      toast.error("Paper order was not filled", {
        description: cause instanceof Error ? cause.message : "A live price is not available.",
      });
    }
  };

  const submitLiveOrder = async () => {
    setSubmitting(true);
    try {
      if (isGtt) {
        const result = await createGttOrder({ symbol: instrument.trading_symbol, quantity, side, product_type: productType, execution_type: gttExecutionType, trigger_price: gttTriggerPrice, limit_price: gttExecutionType === "LIMIT" ? limitPrice : 0, expires_at: parseIstDatetimeLocal(gttExpiry).toISOString() });
        toast.success("GTT order created", { description: `Active until ${new Date(result.expires_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}` });
        onClose();
        return;
      }
      const result = await placeOrder({
        symbol: instrument.trading_symbol,
        quantity,
        side,
        order_type: orderType,
        product_type: productType,
        limit_price: orderType === "LIMIT" ? limitPrice : 0,
        stop_price: 0,
        validity: "DAY",
        disclosed_quantity: 0,
        offline_order: false,
        stop_loss: stopLoss > 0 ? stopLoss : 0,
        take_profit: targetPrice > 0 ? targetPrice : 0,
      });
      toast.success(result.message, { description: result.id ? `Order ID: ${result.id}` : undefined });
      onClose();
    } catch {
      toast.error("Order was not submitted.");
    } finally {
      setSubmitting(false);
    }
  };

  // PageContainer has a fade-in transform. Rendering this fixed-position
  // ticket inside that subtree would make it fixed to the option-chain panel
  // rather than the viewport, so mount it at document.body instead.
  if (typeof document === "undefined") return null;

  return createPortal(
    <aside
      role="dialog"
      aria-modal="false"
      aria-labelledby="quick-order-ticket-title"
      className="fixed bottom-20 left-4 z-50 flex max-h-[calc(100dvh-6rem)] w-[calc(100vw-2rem)] max-w-sm flex-col overflow-y-auto rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-3 shadow-2xl sm:bottom-5 sm:left-5 sm:max-h-[min(80dvh,42rem)] sm:w-[26rem] sm:p-4"
    >
      <Card className="relative flex min-h-0 flex-col border-0 bg-transparent p-0 shadow-none">
        <div className="flex items-start justify-between border-b border-[var(--color-border-subtle)] pb-3">
          <div>
            <h3 id="quick-order-ticket-title" className="flex items-center gap-2 text-sm font-bold text-[var(--color-text-bright)]">
              {side} {instrument.trading_symbol}
              <Badge tone={isPaper ? "blue" : "orange"}>{isPaper ? "Paper mode" : "Live mode"}</Badge>
            </h3>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              {instrument.option_type} {instrument.strike?.toLocaleString()} · Expiry {instrument.expiry} · LTP{" "}
              {ltp > 0 ? formatINR(ltp) : "—"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-bright)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {!isPaper && (!canTrade || !sessionLive) && (
          <div className="mt-4 flex gap-3 rounded-lg border border-[var(--color-accent-orange)]/40 bg-[var(--color-accent-orange)]/5 p-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-accent-orange)]" />
            <p className="text-xs text-[var(--color-text-secondary)]">
              {!sessionLive
                ? "The broker session is unavailable. Reconnect before sending an order."
                : "This session is in Paper mode. Reconnect from Accounts in Live mode to submit real orders."}
            </p>
          </div>
        )}

        {!reviewing && (
          <div className="mt-4 flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Side">
                <Select value={side} onChange={(event) => setSide(event.target.value as OrderSide)}>
                  <option value="Buy">Buy</option>
                  <option value="Sell">Sell</option>
                </Select>
              </Field>
              <Field label={`Quantity (lot size ${lotSize})`}>
                <Input
                  type="number"
                  min={lotSize}
                  step={lotSize || 1}
                  value={quantity}
                  onChange={(event) => setQuantity(Number(event.target.value))}
                />
              </Field>
              <Field label="Order type">
                <Select
                  value={orderType}
                  onChange={(event) => setOrderType(event.target.value as OrderType)}
                >
                  <option value="MARKET">MARKET</option>
                  <option value="LIMIT">LIMIT</option>
                  <option value="GTT">GTT</option>
                </Select>
              </Field>
            </div>
            {(orderType === "LIMIT" || (isGtt && gttExecutionType === "LIMIT")) && (
              <Field label="Limit price">
                <Input
                  type="number"
                  min="0"
                  step="0.05"
                  value={limitPrice || ""}
                  onChange={(event) => setLimitPrice(Number(event.target.value))}
                />
              </Field>
            )}
            {isGtt && <div className="grid grid-cols-2 gap-3 rounded-lg border border-[var(--color-accent-blue)]/40 bg-[var(--color-accent-blue)]/5 p-3"><Field label={`Trigger price (${side === "Buy" ? "above" : "below"} LTP)`}><Input type="number" min="0" step="0.05" value={gttTriggerPrice || ""} onChange={(event) => setGttTriggerPrice(Number(event.target.value))} /></Field><Field label="Execution"><Select value={gttExecutionType} onChange={(event) => setGttExecutionType(event.target.value as "MARKET" | "LIMIT")}><option value="MARKET">MARKET</option><option value="LIMIT">LIMIT</option></Select></Field><Field label="GTT expiry (IST)"><Input type="datetime-local" value={gttExpiry} onChange={(event) => setGttExpiry(event.target.value)} /></Field><p className="col-span-2 text-xs text-[var(--color-text-secondary)]">The trigger stays active until this time. After it fires, the resulting exchange order has DAY validity.</p></div>}
            {!isGtt && <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-hover)]/40 p-3">
              <div className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
                Exit protection
                <EducationPopover
                  title="Stop-loss and target"
                  description="These are option-premium price levels. For a Buy, the stop-loss is below entry and the target is above entry. For a Sell, the stop-loss is above entry and the target is below entry."
                  tips={["Both fields are optional.", "The broker receives these values on live orders; paper orders are monitored while the app is open."]}
                  links={[{ label: "OIC: Options risk management", href: "https://www.optionseducation.org/advancedconcepts/understanding-risk" }]}
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Field label={`Stop-loss (${side === "Buy" ? "below" : "above"} entry)`}>
                  <Input
                    type="number"
                    min="0"
                    step="0.05"
                    value={stopLoss || ""}
                    placeholder="Optional"
                    onChange={(event) => setStopLoss(Number(event.target.value))}
                  />
                </Field>
                <Field label={`Target (${side === "Buy" ? "above" : "below"} entry)`}>
                  <Input
                    type="number"
                    min="0"
                    step="0.05"
                    value={targetPrice || ""}
                    placeholder="Optional"
                    onChange={(event) => setTargetPrice(Number(event.target.value))}
                  />
                </Field>
              </div>
              {riskError && <p className="mt-2 text-xs font-semibold text-[var(--color-loss)]">{riskError}</p>}
            </div>}
            {!isPaper && (
              <Field label="Product">
                <Select
                  value={productType}
                  onChange={(event) => setProductType(event.target.value as ProductType)}
                >
                  <option value="INTRADAY">INTRADAY</option>
                  <option value="CNC">CNC</option>
                  <option value="MARGIN">MARGIN</option>
                </Select>
              </Field>
            )}
            {!isPaper && (
              <div className="rounded-lg border border-[var(--color-border-default)] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Estimated margin</p>
                    <p className="tnum mt-1 text-lg font-black text-[var(--color-text-bright)]">
                      {margin?.total_margin != null ? formatINR(margin.total_margin) : marginLoading ? "Calculating…" : "—"}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => void refreshMargin()} disabled={marginLoading || !isValid}>
                    <RefreshCw className={marginLoading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} /> Refresh
                  </Button>
                </div>
                {margin && (
                  <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
                    Available: {margin.available_margin != null ? formatINR(margin.available_margin) : "—"}
                    {margin.span_margin != null && ` · SPAN: ${formatINR(margin.span_margin)}`}
                    {margin.exposure_margin != null && ` · Exposure: ${formatINR(margin.exposure_margin)}`}
                  </p>
                )}
                {marginError !== null && <ApiErrorDisplay error={marginError} className="mt-2" />}
              </div>
            )}
            {lotSize > 0 && quantity % lotSize !== 0 && (
              <p className="text-xs font-semibold text-[var(--color-loss)]">
                Quantity must be a multiple of the lot size ({lotSize}).
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              {isPaper ? (
                <Button
                  size="sm"
                  className="bg-[var(--color-profit)] text-white hover:opacity-90"
                  disabled={!isValid || ltp <= 0}
                  onClick={submitPaperOrder}
                >
                  Place paper {side.toLowerCase()}
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="bg-[var(--color-profit)] text-white hover:opacity-90"
                  disabled={!isValid || !canTrade || !sessionLive}
                  onClick={() => {
                    setAcknowledged(false);
                    setReviewing(true);
                  }}
                >
                  Review {isGtt ? "GTT" : `live ${side.toLowerCase()}`}
                </Button>
              )}
            </div>
          </div>
        )}

        {reviewing && (
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex gap-3 rounded-lg border border-[var(--color-accent-orange)]/40 bg-[var(--color-accent-orange)]/5 p-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-accent-orange)]" />
              <div>
                <p className="text-sm font-bold text-[var(--color-text-bright)]">Confirm live order</p>
                <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                  {isGtt ? "This creates a conditional GTT. It will submit a real order only when its trigger is reached." : `This sends a real ${side} order request and may create a financial position.`}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 rounded-lg bg-[var(--color-bg-hover)] p-3 text-xs">
              <Metric label="Symbol" value={instrument.trading_symbol} />
              <Metric label="Side" value={side} />
              <Metric label="Quantity" value={String(quantity)} />
              <Metric label="Order type" value={orderType} />
              {isGtt && <><Metric label="Trigger" value={formatINR(gttTriggerPrice)} /><Metric label="Expires" value={parseIstDatetimeLocal(gttExpiry).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} /></>}
              <Metric label="Product" value={productType} />
              {orderType === "LIMIT" && <Metric label="Limit price" value={formatINR(limitPrice)} />}
              {stopLoss > 0 && <Metric label="Stop-loss" value={formatINR(stopLoss)} />}
              {targetPrice > 0 && <Metric label="Target" value={formatINR(targetPrice)} />}
            </div>
            <label className="flex cursor-pointer gap-2 text-xs text-[var(--color-text-primary)]">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                className="mt-0.5 accent-[var(--color-accent-blue)]"
              />
              I have reviewed these details and want to proceed.
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setReviewing(false)}>
                Back
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={!acknowledged || submitting}
                onClick={() => void submitLiveOrder()}
              >
                {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                {isGtt ? "Create GTT" : `Place ${side} order`}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </aside>,
    document.body
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="text-xs font-semibold text-[var(--color-text-secondary)]">
      <span>{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">{label}</p>
      <p className="tnum mt-1 font-bold text-[var(--color-text-primary)]">{value}</p>
    </div>
  );
}
