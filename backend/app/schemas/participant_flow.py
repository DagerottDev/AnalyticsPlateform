"""API contracts for the NSE F&O Participant Flow workspace."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

ParticipantType = Literal["CLIENT", "DII", "FII_FPI", "PROPRIETARY"]
ParticipantDataStatus = Literal["ready", "backfilling", "stale", "unavailable"]


class ParticipantMetrics(BaseModel):
    future_index_long: float = 0
    future_index_short: float = 0
    future_stock_long: float = 0
    future_stock_short: float = 0
    option_index_call_long: float = 0
    option_index_put_long: float = 0
    option_index_call_short: float = 0
    option_index_put_short: float = 0
    option_stock_call_long: float = 0
    option_stock_put_long: float = 0
    option_stock_call_short: float = 0
    option_stock_put_short: float = 0
    total_long: float = 0
    total_short: float = 0


class ParticipantFlowRow(BaseModel):
    trade_date: date
    participant_type: ParticipantType
    oi: ParticipantMetrics
    volume: ParticipantMetrics
    net_oi: float
    net_oi_change: float | None = None


class ParticipantFlowResponse(BaseModel):
    source: Literal["NSE"] = "NSE"
    status: ParticipantDataStatus
    latest_report_date: date | None = None
    last_success_at: datetime | None = None
    last_attempt_at: datetime | None = None
    history_start_date: date | None = None
    backfill_target_start_date: date | None = None
    backfill_completed_at: datetime | None = None
    last_error: str | None = None
    rows: list[ParticipantFlowRow] = Field(default_factory=list)
