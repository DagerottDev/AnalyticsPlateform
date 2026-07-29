from typing import Any

from pydantic import BaseModel


class BrokerPosition(BaseModel):
    """One row from Fyers' /positions, normalized to the fields the UI needs."""

    trading_symbol: str
    symbol: str
    product_type: str
    quantity: float
    side: str  # "Buy" / "Sell" / "Flat", derived from the net quantity's sign
    avg_price: float
    last_price: float
    realized_pnl: float
    unrealized_pnl: float
    pnl: float


class PositionsResponse(BaseModel):
    positions: list[BrokerPosition]
    total_pnl: float
    total_realized_pnl: float
    total_unrealized_pnl: float


class BrokerHolding(BaseModel):
    """One row from Fyers' /holdings, normalized to the fields the UI needs."""

    trading_symbol: str
    symbol: str
    holding_type: str
    quantity: float
    avg_price: float
    last_price: float
    market_value: float
    pnl: float


class HoldingsResponse(BaseModel):
    holdings: list[BrokerHolding]
    total_market_value: float
    total_pnl: float


class FundsResponse(BaseModel):
    """Fyers' /funds returns a fixed list of titled rows rather than a flat
    object, and (like the margin calculator) the exact title strings aren't
    guaranteed stable across API versions — these known fields are matched
    tolerantly by title keyword, and `raw` always carries every row Fyers
    actually returned so nothing is lost if a title doesn't match.
    """

    total_balance: float | None = None
    available_balance: float | None = None
    utilized_amount: float | None = None
    realized_pnl: float | None = None
    unrealized_pnl: float | None = None
    raw: list[dict[str, Any]]
