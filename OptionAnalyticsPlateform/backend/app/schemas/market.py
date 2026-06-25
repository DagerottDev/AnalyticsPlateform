from typing import List, Optional

from pydantic import BaseModel


class Instrument(BaseModel):
    """Represents a trading instrument (e.g., an Option Contract)."""
    trading_symbol: str
    symbol: str
    instrument_type: str
    expiry: Optional[str] = None
    strike: Optional[float] = None
    option_type: Optional[str] = None  # 'CE' or 'PE'
    exchange: str = "NFO"


class ExpiryList(BaseModel):
    """List of available expiries for a given symbol."""
    expiries: List[str]


class StrikeList(BaseModel):
    """List of available strikes for a given symbol and expiry."""
    strikes: List[float]


class InstrumentResponse(BaseModel):
    """Response containing a list of instruments."""
    instruments: List[Instrument]
