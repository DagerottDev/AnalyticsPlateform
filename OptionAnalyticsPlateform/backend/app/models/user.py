"""User and session domain models.

These are internal domain models, not database ORM models (those come in M3).
Used for type-safe user representation across the application.
"""

from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import Enum
from typing import Any


class TradingMode(str, Enum):
    """Trading mode selection."""

    PAPER = "paper"
    LIVE = "live"


@dataclass
class UserProfile:
    """Represents an authenticated user's profile.

    Attributes:
        client_id: Unique client identifier from the broker.
        broker_name: Name of the connected broker.
        trading_mode: Paper or live trading mode.
        account_name: Associated account name.
        funds: Available trading funds (optional, fetched on demand).
        connected_at: Timestamp when the connection was established.
    """

    client_id: str
    broker_name: str
    trading_mode: TradingMode
    account_name: str = "Default"
    funds: dict[str, Any] | None = None
    connected_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    def to_jwt_payload(self) -> dict[str, Any]:
        """Convert user profile to JWT payload dictionary."""
        return {
            "sub": self.client_id,
            "broker": self.broker_name,
            "trading_mode": self.trading_mode.value,
            "account_name": self.account_name,
            "connected_at": self.connected_at.isoformat(),
        }
