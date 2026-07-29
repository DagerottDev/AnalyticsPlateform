from datetime import datetime

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base


class BrokerSessionRecord(Base):
    """Persisted broker session.

    SessionManager itself stays purely in-memory (a live broker client cannot
    be serialized), but everything needed to
    *reconstruct* one — app_id, access_token, trading_mode, account_name —
    is plain data. Persisting just that lets app startup silently restore
    the session instead of forcing a fresh broker login every time the
    backend process restarts (e.g. `uvicorn --reload` picking up a code
    change during development).

    Only one row is ever kept, at a hardcoded id, matching SessionManager's
    single-active-session design.
    """

    __tablename__ = "broker_sessions"  # type: ignore[assignment]

    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    broker: Mapped[str] = mapped_column(String(20), default="fyers")
    client_id: Mapped[str] = mapped_column(String(50))
    app_id: Mapped[str] = mapped_column(String(50))
    # Text, not a bounded varchar: Fernet-encrypted ciphertext (see
    # app.core.crypto) runs noticeably longer than the raw access token.
    access_token: Mapped[str] = mapped_column(Text)
    trading_mode: Mapped[str] = mapped_column(String(10))
    account_name: Mapped[str] = mapped_column(String(100))
    connected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
