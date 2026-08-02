"""Durable intraday aggregate option open-interest observations."""

from datetime import datetime

from sqlalchemy import DateTime, Float, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base


class OpenInterestSnapshot(Base):
    """One owner-scoped, expiry-level OI observation for a 30-second bucket."""

    __tablename__ = "open_interest_snapshots"

    owner_id: Mapped[str] = mapped_column(String(50), primary_key=True)
    symbol: Mapped[str] = mapped_column(String(50), primary_key=True)
    expiry: Mapped[str] = mapped_column(String(32), primary_key=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    total_call_oi: Mapped[float] = mapped_column(Float, nullable=False)
    total_put_oi: Mapped[float] = mapped_column(Float, nullable=False)
    total_call_change: Mapped[float] = mapped_column(Float, nullable=False)
    total_put_change: Mapped[float] = mapped_column(Float, nullable=False)

    __table_args__ = (
        Index(
            "ix_open_interest_snapshot_owner_symbol_expiry_time",
            "owner_id",
            "symbol",
            "expiry",
            "timestamp",
        ),
    )
