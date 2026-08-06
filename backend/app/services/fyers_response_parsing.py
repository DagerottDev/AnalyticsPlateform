"""Pure classification/shaping of Fyers REST responses and order payloads.

Extracted out of FyersService — these functions only need the response/order
dict already in hand (plus the small config dicts a caller already has as
class constants), not the broker client, caches, or pacing locks the rest of
that class deals with.
"""

from typing import Any, NoReturn

from app.core.exceptions import BrokerAuthError, BrokerConnectionError


def is_fyers_auth_response(response: object, auth_error_codes: set[int]) -> bool:
    """Identify Fyers' invalid-session responses without parsing SDK text."""
    if not isinstance(response, dict):
        return False
    code = response.get("code")
    if isinstance(code, int | str):
        try:
            if int(code) in auth_error_codes:
                return True
        except ValueError:
            pass
    message = " ".join(
        str(response.get(key, "")) for key in ("message", "messageBody", "remarks", "error")
    ).lower()
    return any(
        phrase in message
        for phrase in (
            "valid token",
            "invalid token",
            "token expired",
            "token has expired",
            "authenticate",
            "unauthorized",
        )
    )


def fyers_auth_error(response: object, action: str) -> BrokerAuthError:
    """Create a safe, actionable auth error for a failed Fyers response."""
    detail = ""
    if isinstance(response, dict):
        detail = str(response.get("message") or response.get("remarks") or "").strip()
    suffix = f": {detail}" if detail else ""
    return BrokerAuthError(
        f"Fyers session token is invalid or expired while retrieving {action}{suffix}"
    )


def raise_fyers_api_error(response: object, action: str, auth_error_codes: set[int]) -> NoReturn:
    """Raise the right typed error for a non-success Fyers response."""
    if is_fyers_auth_response(response, auth_error_codes):
        raise fyers_auth_error(response, action)
    raise BrokerConnectionError(f"Fyers {action} request failed: {response}")


def require_fyers_order_success(
    response: dict[str, Any] | None, action: str, auth_error_codes: set[int]
) -> dict[str, Any]:
    if not response or response.get("s") != "ok":
        raise_fyers_api_error(response, action, auth_error_codes)
    return response


def build_fyers_order_payload(
    order: dict[str, Any], order_type_codes: dict[str, int]
) -> dict[str, Any]:
    """Shared per-order payload shaping for both single and basket placement."""
    payload = {
        "symbol": order["symbol"],
        "qty": order["quantity"],
        "type": order_type_codes[order["order_type"]],
        "side": 1 if order["side"] == "Buy" else -1,
        "productType": order["product_type"],
        "limitPrice": order["limit_price"],
        "stopPrice": order["stop_price"],
        "validity": order["validity"],
        "disclosedQty": order["disclosed_quantity"],
        "offlineOrder": order["offline_order"],
        "stopLoss": order["stop_loss"],
        "takeProfit": order["take_profit"],
    }
    if order.get("order_tag"):
        payload["orderTag"] = order["order_tag"]
    return payload


# Fyers' bulk-placement endpoint (SDK's place_basket_orders -> POST
# /multi-order/sync) places legs sequentially, returning one result per
# order in the same order they were submitted. The exact success/failure
# shape of each element isn't documented beyond "the response of all the
# orders will be provided... in the same order", so parsing here is
# deliberately tolerant: it never reports a leg as succeeded unless it
# can find an explicit id/ok status for it, and falls back to an
# explicit failure message rather than guessing when the shape doesn't
# match what was expected.
def parse_fyers_basket_order_response(
    response: object, expected_count: int
) -> list[dict[str, Any]]:
    rows: list[Any] | None = None
    if isinstance(response, list):
        rows = response
    elif isinstance(response, dict):
        for key in ("data", "orders", "d"):
            candidate = response.get(key)
            if isinstance(candidate, list):
                rows = candidate
                break
    if rows is None or len(rows) != expected_count:
        raise BrokerConnectionError(
            f"Fyers basket order response did not match the submitted legs: {response}"
        )

    results: list[dict[str, Any]] = []
    for row in rows:
        row_data = row.get("body", row) if isinstance(row, dict) else {}
        order_id = row_data.get("id") if isinstance(row_data, dict) else None
        succeeded = isinstance(row, dict) and (
            row.get("s") == "ok" or row.get("code") == 1100 or order_id is not None
        )
        results.append(
            {
                "id": order_id if succeeded else None,
                "message": str(
                    row_data.get("message", "Order submitted" if succeeded else "Leg failed")
                    if isinstance(row_data, dict)
                    else "Leg failed"
                ),
            }
        )
    return results
