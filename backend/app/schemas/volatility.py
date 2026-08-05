"""Typed response contracts for volatility analytics endpoints."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

IvUniverseStatus = Literal["building", "ready", "stale"]


class IvUniverseSymbol(BaseModel):
    """One latest persisted ATM-IV observation in the F&O universe."""

    symbol: str = Field(min_length=1, max_length=50)
    company_name: str = Field(min_length=1, max_length=200)
    spot: float | None = Field(default=None, ge=0)
    atm_iv: float | None = Field(default=None, ge=0, le=10)
    iv_rank: float | None = Field(default=None, ge=0, le=100)
    iv_percentile: float | None = Field(default=None, ge=0, le=100)
    snapshot_date: date | None = None
    updated_at: datetime | None = None
    status: IvUniverseStatus


class IvUniverseResponse(BaseModel):
    """Full screener snapshot; rows without a broker observation remain visible."""

    symbols: list[IvUniverseSymbol]
    generated_at: datetime
