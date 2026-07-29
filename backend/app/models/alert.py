"""Durable server-side alert definitions and their firing history."""

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Float, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base


class AlertRecord(Base):
    """One user-owned alert that is evaluated independently of the browser."""

    __tablename__ = "alerts"  # type: ignore[assignment]

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(50), index=True)
    instrument: Mapped[dict[str, Any]] = mapped_column(JSON)
    trading_symbol: Mapped[str] = mapped_column(String(100), index=True)
    metric: Mapped[str] = mapped_column(String(30))
    operator: Mapped[str] = mapped_column(String(2))
    threshold: Mapped[float] = mapped_column(Float)
    cooldown_minutes: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(10), default="Active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    triggered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    snoozed_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (Index("ix_alerts_owner_status", "owner_id", "status"),)


class AlertTriggerRecord(Base):
    """An immutable audit record for each server-evaluated alert firing."""

    __tablename__ = "alert_trigger_events"  # type: ignore[assignment]

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(50), index=True)
    alert_id: Mapped[str] = mapped_column(String(36), index=True)
    trading_symbol: Mapped[str] = mapped_column(String(100))
    metric: Mapped[str] = mapped_column(String(30))
    operator: Mapped[str] = mapped_column(String(2))
    threshold: Mapped[float] = mapped_column(Float)
    value: Mapped[float] = mapped_column(Float)
    triggered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)

    __table_args__ = (Index("ix_alert_events_owner_time", "owner_id", "triggered_at"),)
