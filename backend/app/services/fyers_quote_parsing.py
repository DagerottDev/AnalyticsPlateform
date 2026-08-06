"""Pure parsing of one row of Fyers' /quotes REST response.

Extracted out of FyersService.get_quotes — this is a stateless mapping from
Fyers' wire shape to the app's quote shape, so it doesn't need the broker
client, caches, or pacing locks the rest of that method deals with.
"""

import time
from typing import Any

from app.services.fyers_symbols import from_fyers_ws_symbol


def parse_fyers_quote_row(item: dict[str, Any]) -> dict[str, Any] | None:
    """Parse one row of Fyers' /quotes REST response, or return None if the
    row is unusable (missing/unparseable price)."""
    val = item.get("v", {})
    if not isinstance(val, dict):
        return None
    # Fyers uses ``cmd`` for two incompatible payload shapes: some quote
    # responses carry an OHLC mapping there, while the normal v3 response
    # carries the command/symbol string (for example
    # ``NSE:NIFTY50-INDEX``).  Treating the latter as a mapping raises
    # AttributeError and used to discard the entire quote batch, leaving
    # the Option Chain with no live seed or REST fallback despite an
    # active broker session.
    cmd_value = val.get("cmd")
    cmd = cmd_value if isinstance(cmd_value, dict) else {}
    fyers_sym = (
        item.get("n", "")
        or val.get("symbol", "")
        or (cmd_value if isinstance(cmd_value, str) else "")
    )
    lp = cmd.get("lp") or val.get("lp") or val.get("last_price")
    if lp is None or not isinstance(lp, int | float):
        return None

    # Fyers has returned both descriptive keys (``open_price``,
    # ``high_price`` …) and compact OHLC keys (``o``, ``h`` …)
    # across quote API versions. Accept both layouts so the
    # dashboard's snapshot fields are populated consistently.
    open_price = (
        val.get("open_price")
        or val.get("o")
        or cmd.get("o")
        or cmd.get("open_price")
        or 0.0
    )
    prev_close = (
        val.get("prev_close_price")
        or val.get("c")
        or cmd.get("c")
        or cmd.get("prev_close_price")
        or open_price
    )

    ch = val.get("ch") if val.get("ch") is not None else cmd.get("ch")
    if (ch is None or ch == 0) and prev_close and prev_close > 0 and lp != prev_close:
        ch = round(lp - prev_close, 2)
    elif ch is None:
        ch = 0.0

    chp = val.get("chp") if val.get("chp") is not None else cmd.get("chp")
    if (chp is None or chp == 0) and prev_close and prev_close > 0 and ch != 0:
        chp = round((ch / prev_close) * 100.0, 2)
    elif chp is None:
        chp = 0.0

    high_price = (
        val.get("high_price")
        or val.get("h")
        or cmd.get("h")
        or cmd.get("high_price")
        or 0.0
    )
    low_price = (
        val.get("low_price")
        or val.get("l")
        or cmd.get("l")
        or cmd.get("low_price")
        or 0.0
    )
    ask = val.get("ask") or cmd.get("ask") or 0.0
    bid = val.get("bid") or cmd.get("bid") or 0.0
    atp = val.get("atp") or cmd.get("atp") or 0.0

    ui_symbol = from_fyers_ws_symbol(fyers_sym)
    return {
        "symbol": ui_symbol,
        "trading_symbol": ui_symbol,
        "last_price": float(lp),
        "volume": int(
            cmd.get("v")
            or cmd.get("volume")
            or val.get("volume")
            or val.get("v")
            or 0
        ),
        "open_interest": 0,
        "change": float(ch),
        "change_percent": float(chp),
        "open_price": float(open_price),
        "high_price": float(high_price),
        "low_price": float(low_price),
        "prev_close_price": float(prev_close) if prev_close else 0.0,
        "ask": float(ask),
        "bid": float(bid),
        "atp": float(atp),
        "timestamp": int(time.time()),
    }
