from datetime import datetime

from pydantic import BaseModel, ConfigDict


class OHLCV(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    timestamp: datetime
    trading_symbol: str
    open: float
    high: float
    low: float
    close: float
    volume: int
    open_interest: int

class BackfillRequest(BaseModel):
    symbol: str
    from_date: str  # YYYY-MM-DD
    to_date: str    # YYYY-MM-DD
    resolution: str = "1"

class BackfillResponse(BaseModel):
    message: str
    records_inserted: int
