"""Persisted live (real-money) basket orders, tracked so the basket monitor
loop can watch combined P&L and per-leg targets independent of any open
browser tab — mirrors how alerts and market-data backfill already run as
server-side background jobs rather than depending on the frontend."""

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Float, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base


class LiveBasketRecord(Base):
    """One live basket order and the state its monitor loop needs.

    ``legs`` is a JSON list of per-leg dicts:
    {symbol, quantity, side, entry_price, product_type, target, protective_stop_order_id, status}
    where a leg's own ``status`` is "Open" until either its target is hit by
    the monitor loop or the whole basket is closed via the combined
    stop-loss/target.
    """

    __tablename__ = "live_baskets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(50), index=True)
    legs: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    combined_stop_loss: Mapped[float | None] = mapped_column(Float, nullable=True)
    combined_take_profit: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(10), default="Open")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    close_reason: Mapped[str | None] = mapped_column(String(50), nullable=True)

    __table_args__ = (Index("ix_live_baskets_owner_status", "owner_id", "status"),)
