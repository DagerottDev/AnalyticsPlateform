"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useAuth } from "@/hooks/useAuth";
import { createPaperOrder } from "@/lib/paperTrading";
import { placeOrder } from "@/lib/orders";
import { formatINR } from "@/lib/utils";
import { usePositionStore } from "@/stores/positionStore";
import { Instrument, MarketTick } from "@/types/market";

type OrderType = "MARKET" | "LIMIT";
type ProductType = "INTRADAY" | "CNC" | "MARGIN";

interface BuyTicketModalProps {
  symbol: string;
  instrument: Instrument;
  tick: MarketTick | null;
  onClose: () => void;
}

export function BuyTicketModal({ symbol, instrument, tick, onClose }: BuyTicketModalProps) {
  const { tradingMode, canTrade, sessionLive } = useAuth();
  const executePaperOrder = usePositionStore((state) => state.executePaperOrder);

  // Sourced live from the broker's symbol master (see backend's
  // lot_size_store) via the instrument this modal was opened for, not a
  // hardcoded per-symbol table.
  const lotSize = instrument.lot_size ?? 0;
  const ltp = tick?.last_price ?? 0;

  const [quantity, setQuantity] = useState(lotSize);
  const [orderType, setOrderType] = useState<OrderType>("MARKET");
  const [productType, setProductType] = useState<ProductType>("INTRADAY");
  const [limitPrice, setLimitPrice] = useState(ltp);
  const [reviewing, setReviewing] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isPaper = tradingMode === "paper";
  const isValid =
    quantity > 0 && quantity % lotSize === 0 && (orderType !== "LIMIT" || limitPrice > 0);

  const submitPaperBuy = () => {
    try {
      const order = createPaperOrder(
        [{ id: `quickbuy-${Date.now()}`, instrument, action: "Buy", quantity, entryPrice: 0, iv: 0 }],
        () => ltp
      );
      executePaperOrder({
        symbol,
        label: `${instrument.trading_symbol} • Quick buy`,
        legs: order.legs,
        entryCost: order.entryCost,
        fills: order.fills,
      });
      toast.success("Paper buy filled", {
        description: `${quantity} qty of ${instrument.trading_symbol} at ${formatINR(order.fills[0].price)}`,
      });
      onClose();
    } catch (cause) {
      toast.error("Paper order was not filled", {
        description: cause instanceof Error ? cause.message : "A live price is not available.",
      });
    }
  };

  const submitLiveBuy = async () => {
    setSubmitting(true);
    try {
      const result = await placeOrder({
        symbol: instrument.trading_symbol,
        quantity,
        side: "Buy",
        order_type: orderType,
        product_type: productType,
        limit_price: orderType === "LIMIT" ? limitPrice : 0,
        stop_price: 0,
        validity: "DAY",
        disclosed_quantity: 0,
        offline_order: false,
        stop_loss: 0,
        take_profit: 0,
      });
      toast.success(result.message, { description: result.id ? `Order ID: ${result.id}` : undefined });
      onClose();
    } catch {
      toast.error("Order was not submitted.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <Card className="relative w-full max-w-md">
        <div className="flex items-start justify-between border-b border-[var(--color-border-subtle)] pb-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--color-text-bright)]">
              Buy {instrument.trading_symbol}
              <Badge tone={isPaper ? "blue" : "orange"}>{isPaper ? "Paper mode" : "Live mode"}</Badge>
            </h3>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              {instrument.option_type} {instrument.strike?.toLocaleString()} · Expiry {instrument.expiry} · LTP{" "}
              {ltp > 0 ? formatINR(ltp) : "—"}
            </p>
          </div>
          <button
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
              <Field label={`Quantity (lot size ${lotSize})`}>
                <Input
                  type="number"
                  min={lotSize}
                  step={lotSize}
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
                </Select>
              </Field>
            </div>
            {orderType === "LIMIT" && (
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
            {quantity % lotSize !== 0 && (
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
                  onClick={submitPaperBuy}
                >
                  Place paper buy
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
                  Review live buy
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
                  This sends a real Buy order request to Fyers and may create a financial position.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 rounded-lg bg-[var(--color-bg-hover)] p-3 text-xs">
              <Metric label="Symbol" value={instrument.trading_symbol} />
              <Metric label="Quantity" value={String(quantity)} />
              <Metric label="Order type" value={orderType} />
              <Metric label="Product" value={productType} />
              {orderType === "LIMIT" && <Metric label="Limit price" value={formatINR(limitPrice)} />}
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
                onClick={() => void submitLiveBuy()}
              >
                {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                Place Buy order
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
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
