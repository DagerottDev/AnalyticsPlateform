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
