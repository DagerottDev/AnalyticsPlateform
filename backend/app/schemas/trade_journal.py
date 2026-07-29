from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class TradeCreate(BaseModel):
    trading_symbol: str = Field(min_length=3, max_length=100)
    side: Literal["Buy", "Sell"]
    quantity: int = Field(gt=0, le=1_000_000)
    entry_price: float = Field(gt=0)
    exit_price: float | None = Field(default=None, gt=0)
    stop_price: float | None = Field(default=None, gt=0)
    entry_time: datetime
    exit_time: datetime | None = None
    notes: str = Field(default="", max_length=4000)
    tags: list[str] = Field(default_factory=list, max_length=12)
    source: Literal["manual", "paper", "fyers"] = "manual"

    @model_validator(mode="after")
    def validate_exit(self) -> "TradeCreate":
        if self.exit_time and not self.exit_price:
            raise ValueError("exit_price is required when exit_time is supplied")
        if self.exit_time and self.exit_time < self.entry_time:
            raise ValueError("exit_time must not precede entry_time")
        return self


class TradeUpdate(BaseModel):
    exit_price: float = Field(gt=0)
    exit_time: datetime
    notes: str | None = Field(default=None, max_length=4000)
    tags: list[str] | None = Field(default=None, max_length=12)


class TradeResponse(TradeCreate):
    id: str
    pnl: float | None
    risk_reward: float | None
    created_at: datetime
    updated_at: datetime


class JournalSummary(BaseModel):
    closed_trades: int
    win_rate: float | None
    average_risk_reward: float | None
    net_pnl: float
    equity_curve: list[dict[str, float | str]]
