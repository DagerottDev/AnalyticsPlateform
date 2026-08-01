"""Persisted, non-sensitive application preferences for one broker profile."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base


class UserPreferencesRecord(Base):
    """A versioned settings document owned by the authenticated broker client.

    The JSON document keeps the profile extensible while the Pydantic settings
    schema remains the strict validation and normalization boundary.
    """

    __tablename__ = "user_preferences"

    owner_id: Mapped[str] = mapped_column(String(50), primary_key=True)
    schema_version: Mapped[int] = mapped_column(Integer, default=1)
    settings: Mapped[dict[str, object]] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
