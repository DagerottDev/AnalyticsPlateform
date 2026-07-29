
from pydantic import BaseModel


class MarginOrderLeg(BaseModel):
    """One leg of a prospective (not-yet-placed) order, as sent to Fyers'
    multi-order margin calculator."""
    symbol: str
    quantity: int
    side: str  # "Buy" or "Sell"
    product_type: str = "MARGIN"  # Fyers product type: MARGIN (F&O carry), INTRADAY, CNC


class MarginRequest(BaseModel):
    legs: list[MarginOrderLeg]


class MarginResponse(BaseModel):
    """Pass-through of Fyers' margin calculator response `data` block.

    Field names come from Fyers' (sparsely documented) multi-order margin
    calculator API, so unexpected/renamed fields land in `raw` rather than
    being dropped — the frontend falls back to displaying whatever numeric
    fields are present if the expected ones are missing.
    """
    total_margin: float | None = None
    available_margin: float | None = None
    span_margin: float | None = None
    exposure_margin: float | None = None
    premium: float | None = None
    raw: dict


class Instrument(BaseModel):
    """Represents a trading instrument (e.g., an Option Contract)."""
    trading_symbol: str
    symbol: str
    instrument_type: str
    expiry: str | None = None
    strike: float | None = None
    option_type: str | None = None  # 'CE' or 'PE'
    exchange: str = "NFO"
    # Snapshotted from Fyers' optionchain response (refreshed on the
    # service's ~30s instrument cache TTL, not live-ticking). oi_change /
    # oi_change_percent are both vs. the previous trading day's close, same
    # baseline as a live tick's change_percent — used together to classify
    # long/short buildup on the Option Chain page.
    oi: float | None = None
    oi_change: float | None = None
    oi_change_percent: float | None = None


class ExpiryList(BaseModel):
    """List of available expiries for a given symbol."""
    expiries: list[str]


class InstrumentResponse(BaseModel):
    """Response containing a list of instruments."""
    instruments: list[Instrument]


class SymbolSuggestion(BaseModel):
    """One autocomplete match against the static NSE F&O symbol list."""
    symbol: str
    name: str


class SymbolSearchResponse(BaseModel):
    matches: list[SymbolSuggestion]
