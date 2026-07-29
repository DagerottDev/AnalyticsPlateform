"""Persisted daily ATM implied-volatility observations."""

from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base


class DailyVolatilitySnapshot(Base):
    """One immutable ATM-IV observation per underlying and trading day.

    IV Rank is saved alongside the observation as it stood at capture time;
    the current rank is recomputed from this growing series by the API.
    """

    __tablename__ = "daily_volatility_snapshots"

    symbol: Mapped[str] = mapped_column(String(50), primary_key=True)
    snapshot_date: Mapped[date] = mapped_column(Date, primary_key=True)
    atm_iv: Mapped[float] = mapped_column(Float)
    realized_volatility: Mapped[float] = mapped_column(Float)
    iv_rank: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("ix_daily_volatility_snapshot_symbol_date", "symbol", "snapshot_date"),
    )
