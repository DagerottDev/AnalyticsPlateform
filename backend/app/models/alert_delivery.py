"""Per-user channels for alert delivery outside the browser."""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base


class AlertDeliverySettingsRecord(Base):
    __tablename__ = "alert_delivery_settings"  # type: ignore[assignment]

    owner_id: Mapped[str] = mapped_column(String(50), primary_key=True)
    email_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    email_recipient: Mapped[str | None] = mapped_column(String(320), nullable=True)
    webhook_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    webhook_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    telegram_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    telegram_bot_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    telegram_chat_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    slack_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    slack_webhook_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
