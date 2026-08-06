"use client";

import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Pencil, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ApiErrorDisplay } from "@/components/ui/ApiErrorDisplay";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { PageContainer } from "@/components/ui/PageContainer";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Select } from "@/components/ui/Select";
import { useAuth } from "@/hooks/useAuth";
import { BrokerOrder, GttOrder, ModifyOrderRequest, OrderSide, OrderType, PlaceOrderRequest, ProductType, cancelGttOrder, cancelOrder, getGttOrders, getOrders, modifyOrder, placeOrder } from "@/lib/orders";

const orderTypes: OrderType[] = ["MARKET", "LIMIT", "STOP", "STOP_LIMIT"];
const productTypes: ProductType[] = ["INTRADAY", "CNC", "MARGIN"];
type Draft = { symbol: string; quantity: number; side: OrderSide; order_type: OrderType; product_type: ProductType; limit_price: number; stop_price: number; validity: "DAY" | "IOC"; order_tag: string };
const blankDraft: Draft = { symbol: "", quantity: 1, side: "Buy", order_type: "MARKET", product_type: "INTRADAY", limit_price: 0, stop_price: 0, validity: "DAY", order_tag: "" };
const needsLimit = (type: OrderType) => type === "LIMIT" || type === "STOP_LIMIT" || type === ("STOP LIMIT" as OrderType);
const needsStop = (type: OrderType) => type === "STOP" || type === "STOP_LIMIT" || type === ("STOP LIMIT" as OrderType);
const isValid = (order: Pick<Draft, "symbol" | "quantity" | "order_type" | "limit_price" | "stop_price">) => Boolean(order.symbol.trim()) && order.quantity > 0 && (!needsLimit(order.order_type) || order.limit_price > 0) && (!needsStop(order.order_type) || order.stop_price > 0);
const isActionable = (order: BrokerOrder) => order.remaining_quantity > 0 && !/REJECT|CANCEL|COMPLETE|TRADE|FILL/i.test(order.status);
const money = (value: number) => value > 0 ? `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—";

export default function OrdersPage() {
  const { canTrade, sessionLive, tradingMode } = useAuth();
  const [orders, setOrders] = useState<BrokerOrder[]>([]);
  const [gttOrders, setGttOrders] = useState<GttOrder[]>([]);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [reviewing, setReviewing] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<BrokerOrder | null>(null);
  const [amendment, setAmendment] = useState<ModifyOrderRequest | null>(null);
  const [cancelling, setCancelling] = useState<BrokerOrder | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try { const [brokerOrders, gtts] = await Promise.all([getOrders(), getGttOrders()]); setOrders(brokerOrders); setGttOrders(gtts); } catch (cause) { setError(cause); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const review = (event: FormEvent) => {
    event.preventDefault();
    if (!isValid(draft)) return toast.error("Enter an exchange-qualified symbol, quantity, and any required prices.");
    setAcknowledged(false); setReviewing(true);
  };
  const submit = async () => {
    if (!acknowledged || !canTrade || !isValid(draft)) return;
    setSubmitting(true);
    try {
      const payload: PlaceOrderRequest = { ...draft, symbol: draft.symbol.trim().toUpperCase(), disclosed_quantity: 0, offline_order: false, stop_loss: 0, take_profit: 0, order_tag: draft.order_tag.trim() || undefined };
      const result = await placeOrder(payload);
      toast.success(result.message, { description: result.id ? `Order ID: ${result.id}` : undefined });
      setDraft(blankDraft); setReviewing(false); await refresh();
    } catch (cause) { setError(cause); toast.error("Order was not submitted."); } finally { setSubmitting(false); }
  };
  const startAmendment = (order: BrokerOrder) => {
    setEditing(order); setCancelling(null); setAcknowledged(false);
    setAmendment({ quantity: order.remaining_quantity || order.quantity, order_type: order.order_type, limit_price: order.limit_price, stop_price: order.stop_price });
  };
  const submitAmendment = async () => {
    if (!editing || !amendment || !acknowledged || !isValid({ symbol: editing.trading_symbol, ...amendment })) return;
    setSubmitting(true);
    try { const result = await modifyOrder(editing.id, amendment); toast.success(result.message); setEditing(null); setAmendment(null); await refresh(); }
    catch (cause) { setError(cause); toast.error("Order was not modified."); } finally { setSubmitting(false); }
  };
  const submitCancellation = async () => {
    if (!cancelling || !acknowledged) return;
    setSubmitting(true);
    try { const result = await cancelOrder(cancelling.id); toast.success(result.message); setCancelling(null); await refresh(); }
    catch (cause) { setError(cause); toast.error("Order was not cancelled."); } finally { setSubmitting(false); }
  };
  const cancelGtt = async (id: string) => { try { await cancelGttOrder(id); toast.success("GTT cancelled"); await refresh(); } catch (cause) { setError(cause); toast.error("Could not cancel GTT."); } };

  return <DashboardLayout><PageContainer>
    <div className="flex flex-wrap items-start justify-between gap-4"><SectionHeader title="Orders" description="Place, modify, and cancel live Fyers orders with an explicit final confirmation." /><Button variant="secondary" onClick={() => void refresh()} disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh orders</Button></div>
    {!canTrade && <Card className="flex gap-3 border-[var(--color-accent-orange)]/40 bg-[var(--color-accent-orange)]/5"><ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-accent-orange)]" /><div><p className="text-sm font-bold text-[var(--color-text-bright)]">Live execution is locked</p><p className="mt-1 text-xs text-[var(--color-text-secondary)]">This session is in {tradingMode === "paper" ? "Paper" : "an unavailable"} mode. Reconnect from Accounts in Live mode to submit orders; the server verifies this independently.</p></div></Card>}
    {!sessionLive && <Card><p className="text-sm text-[var(--color-accent-orange)]">The broker session is unavailable. Reconnect before sending an order.</p></Card>}
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.85fr_1.15fr]">
      <Card><form className="flex flex-col gap-4" onSubmit={review}><div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] pb-3"><h3 className="text-sm font-bold text-[var(--color-text-bright)]">New live order</h3><Badge tone={canTrade ? "loss" : "neutral"}>{canTrade ? "Live execution" : "Read only"}</Badge></div><Field label="Fyers trading symbol"><Input required value={draft.symbol} onChange={e => setDraft({ ...draft, symbol: e.target.value })} placeholder="NSE:SBIN-EQ or NFO:NIFTY..." /></Field><div className="grid grid-cols-2 gap-3"><Field label="Side"><Select value={draft.side} onChange={e => setDraft({ ...draft, side: e.target.value as OrderSide })}><option>Buy</option><option>Sell</option></Select></Field><Field label="Quantity"><Input type="number" min="1" value={draft.quantity} onChange={e => setDraft({ ...draft, quantity: Number(e.target.value) })} /></Field><Field label="Order type"><Select value={draft.order_type} onChange={e => setDraft({ ...draft, order_type: e.target.value as OrderType, limit_price: 0, stop_price: 0 })}>{orderTypes.map(type => <option key={type}>{type.replace("_", " ")}</option>)}</Select></Field><Field label="Product"><Select value={draft.product_type} onChange={e => setDraft({ ...draft, product_type: e.target.value as ProductType })}>{productTypes.map(type => <option key={type}>{type}</option>)}</Select></Field></div>{(needsLimit(draft.order_type) || needsStop(draft.order_type)) && <PriceFields order={draft} onChange={setDraft} />}<div className="grid grid-cols-2 gap-3"><Field label="Validity"><Select value={draft.validity} onChange={e => setDraft({ ...draft, validity: e.target.value as "DAY" | "IOC" })}><option>DAY</option><option>IOC</option></Select></Field><Field label="Order tag (optional)"><Input maxLength={20} value={draft.order_tag} onChange={e => setDraft({ ...draft, order_tag: e.target.value })} placeholder="manual-entry" /></Field></div><Button type="submit" disabled={!canTrade || !sessionLive}>Review live order</Button></form></Card>
      <div className="flex flex-col gap-6">{reviewing && <Confirmation title="Confirm live order" description="This sends a real order request to Fyers and may create a financial position." acknowledged={acknowledged} setAcknowledged={setAcknowledged} onCancel={() => setReviewing(false)} onSubmit={() => void submit()} submitting={submitting} label={`Place ${draft.side} order`}><Summary symbol={draft.symbol} side={draft.side} type={draft.order_type} quantity={draft.quantity} limit={draft.limit_price} stop={draft.stop_price} /></Confirmation>}{editing && amendment && <Confirmation title="Confirm modification" description={`This changes the pending Fyers order ${editing.id}.`} acknowledged={acknowledged} setAcknowledged={setAcknowledged} onCancel={() => { setEditing(null); setAmendment(null); }} onSubmit={() => void submitAmendment()} submitting={submitting} label="Modify order"><div className="grid grid-cols-2 gap-3"><Field label="Quantity"><Input type="number" min="1" value={amendment.quantity} onChange={e => setAmendment({ ...amendment, quantity: Number(e.target.value) })} /></Field><Field label="Order type"><Select value={amendment.order_type} onChange={e => setAmendment({ ...amendment, order_type: e.target.value as OrderType, limit_price: 0, stop_price: 0 })}>{orderTypes.map(type => <option key={type}>{type.replace("_", " ")}</option>)}</Select></Field></div>{(needsLimit(amendment.order_type) || needsStop(amendment.order_type)) && <AmendmentPrices amendment={amendment} setAmendment={setAmendment} />}</Confirmation>}{cancelling && <Confirmation title="Confirm cancellation" description={`This asks Fyers to cancel ${cancelling.id}. Any filled quantity cannot be reversed.`} acknowledged={acknowledged} setAcknowledged={setAcknowledged} onCancel={() => setCancelling(null)} onSubmit={() => void submitCancellation()} submitting={submitting} label="Cancel pending order"><Summary symbol={cancelling.trading_symbol} side={cancelling.side} type={cancelling.order_type} quantity={cancelling.remaining_quantity} limit={cancelling.limit_price} stop={cancelling.stop_price} /></Confirmation>}<GttBook orders={gttOrders} loading={loading} onCancel={cancelGtt} /><OrderBook orders={orders} loading={loading} canTrade={canTrade} onEdit={startAmendment} onCancel={order => { setEditing(null); setCancelling(order); setAcknowledged(false); }} /></div>
    </div>{error ? <ApiErrorDisplay error={error} /> : null}
  </PageContainer></DashboardLayout>;
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="text-xs font-semibold text-[var(--color-text-secondary)]"><span>{label}</span><div className="mt-1.5">{children}</div></label>; }
function PriceFields({ order, onChange }: { order: Draft; onChange: (value: Draft) => void }) { return <div className="grid grid-cols-2 gap-3">{needsLimit(order.order_type) && <Field label="Limit price"><Input type="number" min="0" step="0.05" value={order.limit_price || ""} onChange={e => onChange({ ...order, limit_price: Number(e.target.value) })} /></Field>}{needsStop(order.order_type) && <Field label="Stop price"><Input type="number" min="0" step="0.05" value={order.stop_price || ""} onChange={e => onChange({ ...order, stop_price: Number(e.target.value) })} /></Field>}</div>; }
function AmendmentPrices({ amendment, setAmendment }: { amendment: ModifyOrderRequest; setAmendment: (value: ModifyOrderRequest) => void }) { return <div className="mt-3 grid grid-cols-2 gap-3">{needsLimit(amendment.order_type) && <Field label="Limit price"><Input type="number" min="0" step="0.05" value={amendment.limit_price || ""} onChange={e => setAmendment({ ...amendment, limit_price: Number(e.target.value) })} /></Field>}{needsStop(amendment.order_type) && <Field label="Stop price"><Input type="number" min="0" step="0.05" value={amendment.stop_price || ""} onChange={e => setAmendment({ ...amendment, stop_price: Number(e.target.value) })} /></Field>}</div>; }
function Summary({ symbol, side, type, quantity, limit, stop }: { symbol: string; side: OrderSide; type: OrderType; quantity: number; limit: number; stop: number }) { return <div className="grid grid-cols-2 gap-3 rounded-lg bg-[var(--color-bg-hover)] p-3 text-xs"><Metric label="Symbol" value={symbol.toUpperCase()} /><Metric label="Side" value={side} accent={side === "Buy" ? "profit" : "loss"} /><Metric label="Quantity" value={String(quantity)} /><Metric label="Type" value={type.replace("_", " ")} /><Metric label="Limit price" value={money(limit)} /><Metric label="Stop price" value={money(stop)} /></div>; }
function Metric({ label, value, accent }: { label: string; value: string; accent?: "profit" | "loss" }) { return <div><p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">{label}</p><p className={`tnum mt-1 font-bold ${accent === "profit" ? "text-[var(--color-profit)]" : accent === "loss" ? "text-[var(--color-loss)]" : "text-[var(--color-text-primary)]"}`}>{value}</p></div>; }
function Confirmation({ title, description, children, acknowledged, setAcknowledged, onCancel, onSubmit, submitting, label }: { title: string; description: string; children: ReactNode; acknowledged: boolean; setAcknowledged: (value: boolean) => void; onCancel: () => void; onSubmit: () => void; submitting: boolean; label: string }) { return <Card className="border-[var(--color-accent-orange)]/40"><div className="flex gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-accent-orange)]" /><div className="min-w-0 flex-1"><h3 className="text-sm font-bold text-[var(--color-text-bright)]">{title}</h3><p className="mt-1 text-xs text-[var(--color-text-secondary)]">{description}</p><div className="mt-4">{children}</div><label className="mt-4 flex cursor-pointer gap-2 text-xs text-[var(--color-text-primary)]"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} className="mt-0.5 accent-[var(--color-accent-blue)]" />I have reviewed these details and want to proceed.</label><div className="mt-4 flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={onCancel}>Back</Button><Button variant="danger" size="sm" onClick={onSubmit} disabled={!acknowledged || submitting}>{submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}{label}</Button></div></div></div></Card>; }
function OrderBook({ orders, loading, canTrade, onEdit, onCancel }: { orders: BrokerOrder[]; loading: boolean; canTrade: boolean; onEdit: (order: BrokerOrder) => void; onCancel: (order: BrokerOrder) => void }) { return <Card className="overflow-hidden p-0"><div className="flex items-center justify-between border-b border-[var(--color-border-default)] px-4 py-3"><div><h3 className="text-sm font-bold text-[var(--color-text-bright)]">Today&apos;s orders</h3><p className="mt-0.5 text-xs text-[var(--color-text-muted)]">Pending and completed Fyers orders</p></div><Badge tone="blue">Fyers</Badge></div>{loading ? <div className="p-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-[var(--color-accent-blue)]" /></div> : orders.length === 0 ? <EmptyState className="py-10" title="No broker orders today." /> : <div className="overflow-x-auto"><table className="w-full min-w-[750px] text-left text-sm"><thead className="bg-[var(--color-bg-hover)] text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]"><tr><th className="px-4 py-3">Instrument</th><th className="px-4 py-3">Order</th><th className="px-4 py-3 text-right">Qty</th><th className="px-4 py-3 text-right">Prices</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th></tr></thead><tbody>{orders.map(order => <tr key={order.id} className="border-t border-[var(--color-border-subtle)]"><td className="px-4 py-3"><p className="font-semibold text-[var(--color-text-primary)]">{order.trading_symbol}</p><p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">{order.product_type} · {order.id}</p></td><td className="px-4 py-3"><span className={order.side === "Buy" ? "text-[var(--color-profit)]" : "text-[var(--color-loss)]"}>{order.side}</span><span className="ml-2 text-xs text-[var(--color-text-secondary)]">{order.order_type.replace("_", " ")}</span></td><td className="tnum px-4 py-3 text-right">{order.filled_quantity}/{order.quantity}</td><td className="tnum px-4 py-3 text-right text-xs">L {money(order.limit_price)}<br />S {money(order.stop_price)}</td><td className="px-4 py-3"><Badge tone={/REJECT|CANCEL/i.test(order.status) ? "loss" : /TRADE|FILL/i.test(order.status) ? "profit" : "neutral"}>{order.status}</Badge></td><td className="px-4 py-3"><div className="flex justify-end gap-1">{isActionable(order) ? <><Button variant="icon" aria-label={`Modify ${order.id}`} onClick={() => onEdit(order)} disabled={!canTrade}><Pencil className="h-3.5 w-3.5" /></Button><Button variant="icon" aria-label={`Cancel ${order.id}`} onClick={() => onCancel(order)} disabled={!canTrade}><Trash2 className="h-3.5 w-3.5 text-[var(--color-loss)]" /></Button></> : "—"}</div></td></tr>)}</tbody></table></div>}</Card>; }
function GttBook({ orders, loading, onCancel }: { orders: GttOrder[]; loading: boolean; onCancel: (id: string) => void }) { return <Card><div className="flex items-center justify-between"><div><h3 className="text-sm font-bold text-[var(--color-text-bright)]">GTT orders</h3><p className="text-xs text-[var(--color-text-muted)]">Server-hosted Fyers and native Dhan conditional entries.</p></div><Badge tone="blue">GTT</Badge></div>{loading ? <p className="mt-3 text-xs text-[var(--color-text-muted)]">Loading…</p> : orders.length === 0 ? <p className="mt-3 text-sm text-[var(--color-text-muted)]">No GTT orders.</p> : <div className="mt-3 space-y-2">{orders.map(order => <div key={order.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--color-border-default)] p-2 text-xs"><span>{order.symbol} · {order.side} · {order.quantity} @ trigger {money(order.trigger_price)}</span><span>Expires {new Date(order.expires_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</span><Badge tone={order.status === "Placed" ? "profit" : order.status === "Unknown" ? "orange" : /Failed|Cancelled|Expired/.test(order.status) ? "loss" : "neutral"}>{order.status}</Badge>{order.status === "Pending" && <Button size="sm" variant="outline" onClick={() => onCancel(order.id)}>Cancel</Button>}</div>)}</div>}</Card>; }
