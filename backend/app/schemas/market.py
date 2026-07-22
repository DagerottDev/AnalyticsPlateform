
from pydantic import BaseModel


class Instrument(BaseModel):
    """Represents a trading instrument (e.g., an Option Contract)."""
    trading_symbol: str
    symbol: str
    instrument_type: str
    expiry: str | None = None
    strike: float | None = None
    option_type: str | None = None  # 'CE' or 'PE'
    exchange: str = "NFO"


class ExpiryList(BaseModel):
    """List of available expiries for a given symbol."""
    expiries: list[str]


class InstrumentResponse(BaseModel):
    """Response containing a list of instruments."""
    instruments: list[Instrument]
