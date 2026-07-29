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

export interface PlaceOrderRequest {
  symbol: string; quantity: number; side: OrderSide; order_type: OrderType; product_type: ProductType;
  limit_price: number; stop_price: number; validity: "DAY" | "IOC"; disclosed_quantity: number;
  offline_order: boolean; stop_loss: number; take_profit: number; order_tag?: string;
}

export interface ModifyOrderRequest { quantity: number; order_type: OrderType; limit_price: number; stop_price: number; }

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
