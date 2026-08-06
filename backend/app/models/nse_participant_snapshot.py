"""Durable, broker-independent NSE F&O participant report snapshots."""

from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base


class NseParticipantSnapshot(Base):
    """One participant category in NSE's daily F&O OI and volume reports."""

    __tablename__ = "nse_participant_snapshots"

    trade_date: Mapped[date] = mapped_column(Date, primary_key=True)
    participant_type: Mapped[str] = mapped_column(String(16), primary_key=True)

    oi_future_index_long: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    oi_future_index_short: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    oi_future_stock_long: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    oi_future_stock_short: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    oi_option_index_call_long: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    oi_option_index_put_long: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    oi_option_index_call_short: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    oi_option_index_put_short: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    oi_option_stock_call_long: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    oi_option_stock_put_long: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    oi_option_stock_call_short: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    oi_option_stock_put_short: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    oi_total_long: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    oi_total_short: Mapped[float] = mapped_column(Float, nullable=False, default=0)

    volume_future_index_long: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    volume_future_index_short: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    volume_future_stock_long: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    volume_future_stock_short: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    volume_option_index_call_long: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    volume_option_index_put_long: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    volume_option_index_call_short: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    volume_option_index_put_short: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    volume_option_stock_call_long: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    volume_option_stock_put_long: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    volume_option_stock_call_short: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    volume_option_stock_put_short: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    volume_total_long: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    volume_total_short: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (Index("ix_nse_participant_snapshot_trade_date", "trade_date"),)


class NseParticipantImportState(Base):
    """Import status shared by all viewers of the public NSE report."""

    __tablename__ = "nse_participant_import_state"

    source: Mapped[str] = mapped_column(String(32), primary_key=True)
    last_successful_trade_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    backfill_target_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    backfill_completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
