"""Request and response schemas for durable market alerts."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


def _camel(name: str) -> str:
    head, *tail = name.split("_")
    return head + "".join(part.capitalize() for part in tail)


class AlertBase(BaseModel):
    model_config = ConfigDict(alias_generator=_camel, populate_by_name=True)

    instrument: dict[str, Any]
    metric: Literal[
        "Price",
        "IV",
        "Delta",
        "Gamma",
        "Theta",
        "Vega",
        "Call GEX",
        "Put GEX",
        "Net GEX",
        "VWAP Breakout",
    ]
    operator: Literal[">", "<", ">=", "<="]
    threshold: float
    cooldown_minutes: int = Field(ge=0, le=1440)


class AlertCreate(AlertBase):
    pass


class AlertResponse(AlertBase):
    id: str
    status: Literal["Active", "Snoozed", "Disabled"]
    created_at: datetime
    triggered_at: datetime | None = None
    snoozed_until: datetime | None = None


class AlertTriggerResponse(BaseModel):
    model_config = ConfigDict(alias_generator=_camel, populate_by_name=True)

    id: str
    alert_id: str
    trading_symbol: str
    metric: str
    operator: str
    threshold: float
    value: float
    triggered_at: datetime
