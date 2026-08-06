import { apiClient } from "@/lib/api";

export type OrderSide = "Buy" | "Sell";
export type OrderType = "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT";
export type ProductType = "INTRADAY" | "CNC" | "MARGIN";

export interface BrokerOrder {
  id: string;
  trading_symbol: string;
  side: OrderSide;
  order_type: OrderType;
  product_type: string;
  quantity: number;
  filled_quantity: number;
  remaining_quantity: number;
  limit_price: number;
  stop_price: number;
  status: string;
  status_message: string | null;
  order_time: string | null;
}

export interface OrderActionResponse { id: string | null; message: string; }
// "Unknown" means a trigger/native-GTT placement call raised without a
// clear rejection from the broker — it's not yet known whether the order
// actually went through before the exception happened. The server-side
// monitor reconciles it against the broker's order book every tick,
// resolving to "Placed" or (after a timeout with no match) "Failed".
export interface GttOrder { id: string; broker_name: string; symbol: string; side: OrderSide; quantity: number; product_type: string; execution_type: "MARKET" | "LIMIT"; trigger_price: number; limit_price: number; expires_at: string; status: "Pending" | "Triggered" | "Placed" | "Failed" | "Cancelled" | "Expired" | "Unknown"; native_order_id: string | null; execution_order_id: string | null; error_message: string | null; created_at: string; triggered_at: string | null; closed_at: string | null; }
export interface CreateGttOrderRequest { symbol: string; quantity: number; side: OrderSide; product_type: ProductType; execution_type: "MARKET" | "LIMIT"; trigger_price: number; limit_price: number; expires_at: string; }

export interface PlaceOrderRequest {
  symbol: string; quantity: number; side: OrderSide; order_type: OrderType; product_type: ProductType;
  limit_price: number; stop_price: number; validity: "DAY" | "IOC"; disclosed_quantity: number;
  offline_order: boolean; stop_loss: number; take_profit: number; order_tag?: string;
}

export interface ModifyOrderRequest { quantity: number; order_type: OrderType; limit_price: number; stop_price: number; }

export interface PlaceBasketLegRequest {
  symbol: string; quantity: number; side: OrderSide; product_type: ProductType;
  order_type: "MARKET"; limit_price: number; stop_price: number;
  validity: "DAY"; disclosed_quantity: number; offline_order: boolean;
  stop_loss?: number; target_price?: number;
}
export interface BasketLegResult {
  symbol: string; id: string | null; message: string; status: string;
  filled_quantity: number; protective_stop_order_id: string | null;
}
export interface BasketOrderResponse { basket_id: string | null; legs: BasketLegResult[]; }

export async function getOrders(): Promise<BrokerOrder[]> {
  const response = await apiClient.get<{ orders: BrokerOrder[] }>("/orders");
  return response.data.orders;
}
export async function placeOrder(order: PlaceOrderRequest): Promise<OrderActionResponse> {
  const normalized = { ...order, order_type: order.order_type === ("STOP LIMIT" as OrderType) ? "STOP_LIMIT" : order.order_type };
  return (await apiClient.post<OrderActionResponse>("/orders", normalized)).data;
}
export async function modifyOrder(id: string, order: ModifyOrderRequest): Promise<OrderActionResponse> {
  const normalized = { ...order, order_type: order.order_type === ("STOP LIMIT" as OrderType) ? "STOP_LIMIT" : order.order_type };
  return (await apiClient.patch<OrderActionResponse>(`/orders/${encodeURIComponent(id)}`, normalized)).data;
}
export async function cancelOrder(id: string): Promise<OrderActionResponse> {
  return (await apiClient.delete<OrderActionResponse>(`/orders/${encodeURIComponent(id)}`)).data;
}
export async function getGttOrders(): Promise<GttOrder[]> { return (await apiClient.get<{ orders: GttOrder[] }>("/orders/gtt")).data.orders; }
export async function createGttOrder(order: CreateGttOrderRequest): Promise<GttOrder> { return (await apiClient.post<GttOrder>("/orders/gtt", order)).data; }
export async function cancelGttOrder(id: string): Promise<GttOrder> { return (await apiClient.delete<GttOrder>(`/orders/gtt/${encodeURIComponent(id)}`)).data; }
export async function placeBasketOrder(request: {
  legs: PlaceBasketLegRequest[];
  combined_stop_loss?: number;
  combined_take_profit?: number;
}): Promise<BasketOrderResponse> {
  return (await apiClient.post<BasketOrderResponse>("/orders/basket", request)).data;
}
