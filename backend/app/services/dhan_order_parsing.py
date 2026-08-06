"""Pure parsing/validation of Dhan order and quote-row responses.

Extracted out of DhanService — these functions only need the response/row
dict already in hand, not the broker HTTP client or session state the rest
of that class deals with.
"""

from typing import Any

from app.core.exceptions import BrokerConnectionError


def normalise_dhan_order(row: dict[str, Any]) -> dict[str, Any]:
    quantity = int(row.get("quantity", 0) or 0)
    filled = int(row.get("filledQty", row.get("filledQuantity", 0)) or 0)
    order_type = str(row.get("orderType", "MARKET")).upper()
    return {
        "id": str(row.get("orderId", "")),
        "trading_symbol": str(row.get("tradingSymbol", row.get("securityId", ""))),
        "side": "Buy" if str(row.get("transactionType", "BUY")).upper() == "BUY" else "Sell",
        "order_type": "STOP" if order_type == "STOP_LOSS" else order_type,
        "product_type": str(row.get("productType", "")),
        "quantity": quantity,
        "filled_quantity": filled,
        "remaining_quantity": int(row.get("remainingQuantity", max(quantity - filled, 0)) or 0),
        "average_price": float(row.get("averageTradedPrice", row.get("averagePrice", 0)) or 0),
        "limit_price": float(row.get("price", 0) or 0),
        "stop_price": float(row.get("triggerPrice", 0) or 0),
        "status": str(row.get("orderStatus", "Unknown")),
        "status_message": row.get("remarks"),
        "order_time": row.get("createTime"),
        # Echoed back for any order placed with a correlationId — lets a
        # caller reconcile an ambiguous placement failure by searching
        # the order book for the tag it submitted, rather than by
        # broker-generated id (which it may never have received). See
        # order_reconciliation.find_order_by_tag.
        "order_tag": row.get("correlationId") or None,
    }


def require_dhan_order_id(data: dict[str, Any], action: str) -> str:
    """Dhan can report an order rejection (RMS/margin/validation) with a
    2xx HTTP status and no orderId in the body — `_request` only raises
    for HTTP-level errors and 401/403, so that response would otherwise
    flow straight through as a "successful" placement. Contrast with
    Fyers, whose adapter always checks the response envelope's own
    success flag (see fyers_response_parsing.require_fyers_order_success)
    and raises rather than returning `{"id": None, ...}`. Without the same
    check here, a rejected Dhan order comes back through
    `POST /api/v1/orders` as an HTTP 201 Created with `id: None` —
    reported to the caller as placed when the broker actually rejected
    it.
    """
    order_id = str(data.get("orderId", "")).strip()
    if not order_id:
        message = data.get("remarks") or data.get("message") or str(data)
        raise BrokerConnectionError(f"Dhan {action} was not accepted: {message}")
    return order_id


def parse_dhan_quote_row(
    segment: str, security_id: str, value: dict[str, Any], names: dict[tuple[str, str], str]
) -> dict[str, Any]:
    """Shape one security's row from Dhan's /marketfeed/ltp response."""
    ref = names.get((segment, str(security_id)), f"{segment}:{security_id}")
    ltp = value.get("last_price", value.get("lastTradedPrice", value.get("ltp", 0)))
    return {
        "symbol": ref,
        # Keep the exact symbol requested by the UI. Dhan may return a
        # display-only tradingSymbol for an option, but the websocket
        # handler is keyed by this request symbol (for example NIFTY or
        # NSE_FNO:26009).
        "trading_symbol": ref,
        "last_price": float(ltp or 0),
        "volume": int(value.get("volume", 0) or 0),
        "open_interest": int(value.get("oi", 0) or 0),
        "change": float(value.get("change", 0) or 0),
        "change_percent": float(value.get("changePercent", 0) or 0),
        "open_price": float(value.get("open", 0) or 0),
        "high_price": float(value.get("high", 0) or 0),
        "low_price": float(value.get("low", 0) or 0),
        "prev_close_price": float(value.get("close", 0) or 0),
        "ask": float(value.get("ask", 0) or 0),
        "bid": float(value.get("bid", 0) or 0),
        "atp": float(value.get("avgPrice", 0) or 0),
        "timestamp": int(value.get("timestamp", 0) or 0),
    }
