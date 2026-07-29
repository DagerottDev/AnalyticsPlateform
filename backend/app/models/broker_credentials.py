from datetime import datetime

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base


class BrokerCredentialsRecord(Base):
    """Persisted Fyers TOTP login credentials — the source of truth for
    silent auto-login (see app.api.v1.auth.auto_login). Saved automatically
    whenever a headless TOTP login succeeds (see app.api.v1.auth.login), so
    the app never needs credentials duplicated into backend/.env.

    api_secret/totp_secret/pin are encrypted at rest (app.core.crypto), same
    as BrokerSessionRecord.access_token. Only one row is ever kept, at a
    hardcoded id, matching the app's single-broker-account design.
    """

    __tablename__ = "broker_credentials"

    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    app_id: Mapped[str] = mapped_column(String(50))
    api_secret: Mapped[str] = mapped_column(Text)
    client_id: Mapped[str] = mapped_column(String(50))
    totp_secret: Mapped[str] = mapped_column(Text)
    pin: Mapped[str] = mapped_column(Text)
    redirect_uri: Mapped[str] = mapped_column(String(200))
    trading_mode: Mapped[str] = mapped_column(String(10))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
