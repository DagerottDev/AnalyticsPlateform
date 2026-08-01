"""Durable Good-Till-Triggered order state."""

from datetime import datetime

from sqlalchemy import DateTime, Float, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base


class GttOrderRecord(Base):
    __tablename__ = "gtt_orders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(50), index=True)
    broker_name: Mapped[str] = mapped_column(String(20))
    symbol: Mapped[str] = mapped_column(String(80))
    side: Mapped[str] = mapped_column(String(4))
    quantity: Mapped[int] = mapped_column(Integer)
    product_type: Mapped[str] = mapped_column(String(20))
    execution_type: Mapped[str] = mapped_column(String(10))
    trigger_price: Mapped[float] = mapped_column(Float)
    limit_price: Mapped[float] = mapped_column(Float, default=0)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(12), default="Pending")
    native_order_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    execution_order_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    triggered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (Index("ix_gtt_orders_owner_status", "owner_id", "status"),)
