"""Latest-and-historical ATM-IV snapshots across the whole NSE F&O stock universe.

Deliberately separate from ``DailyVolatilitySnapshot``: that table stores one
immutable observation per day and is overlaid directly onto the single-symbol
historical IV/RV chart, whereas this table is refreshed in place through the
day as the universe backfill job progresses and carries no realized-vol
column at all.
"""

from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base


class FoIvUniverseSnapshot(Base):
    """One (possibly refreshed) ATM-IV observation per F&O stock and trading day."""

    __tablename__ = "fo_iv_universe_snapshots"

    symbol: Mapped[str] = mapped_column(String(50), primary_key=True)
    snapshot_date: Mapped[date] = mapped_column(Date, primary_key=True)
    atm_iv: Mapped[float] = mapped_column(Float)
    spot: Mapped[float | None] = mapped_column(Float, nullable=True)
    iv_rank: Mapped[float | None] = mapped_column(Float, nullable=True)
    iv_percentile: Mapped[float | None] = mapped_column(Float, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("ix_fo_iv_universe_snapshot_symbol_date", "symbol", "snapshot_date"),
    )
