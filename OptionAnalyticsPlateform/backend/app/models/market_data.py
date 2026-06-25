from datetime import datetime

from sqlalchemy import Column, Float, Integer, String, DateTime, Index
from app.db.base_class import Base

class MarketData(Base):
    """Historical OHLCV data for an instrument."""
    __tablename__ = "market_data"

    # In TimescaleDB, a hypertable is partitioned by a time column.
    # While we can have a primary key, usually it's a composite of time + symbol 
    # or omitted if just append-only. We use a standard composite approach for SQLAlchemy.
    
    timestamp = Column(DateTime(timezone=True), primary_key=True, index=True)
    trading_symbol = Column(String(50), primary_key=True, index=True)
    
    open = Column(Float, nullable=False)
    high = Column(Float, nullable=False)
    low = Column(Float, nullable=False)
    close = Column(Float, nullable=False)
    volume = Column(Integer, nullable=False, default=0)
    open_interest = Column(Integer, nullable=False, default=0)
    
    # We create an index on trading_symbol and timestamp to speed up common queries
    __table_args__ = (
        Index("ix_market_data_symbol_time", "trading_symbol", "timestamp", unique=True),
    )
