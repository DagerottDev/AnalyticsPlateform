
from datetime import datetime

from sqlalchemy import DateTime, Float, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base


class MarketData(Base):
    """Historical OHLCV data for an instrument."""
    __tablename__ = "market_data"

    # In TimescaleDB, a hypertable is partitioned by a time column.
    # While we can have a primary key, usually it's a composite of time + symbol
    # or omitted if just append-only. We use a standard composite approach for SQLAlchemy.

    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), primary_key=True, index=True
    )
    trading_symbol: Mapped[str] = mapped_column(String(50), primary_key=True, index=True)

    open: Mapped[float] = mapped_column(Float, nullable=False)
    high: Mapped[float] = mapped_column(Float, nullable=False)
    low: Mapped[float] = mapped_column(Float, nullable=False)
    close: Mapped[float] = mapped_column(Float, nullable=False)
    volume: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    open_interest: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # We create an index on trading_symbol and timestamp to speed up common queries
    __table_args__ = (
        Index("ix_market_data_symbol_time", "trading_symbol", "timestamp", unique=True),
    )
