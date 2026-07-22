"""Base broker service abstraction.

Provides a common interface for all supported brokers.
"""

from abc import ABC, abstractmethod
from typing import Any

from app.models.user import TradingMode, UserProfile


class BrokerService(ABC):
    """Abstract base class for broker integrations."""

    def __init__(
        self,
        trading_mode: TradingMode = TradingMode.PAPER,
        account_name: str = "Default",
    ) -> None:
        self.trading_mode = trading_mode
        self.account_name = account_name

    @abstractmethod
    async def verify_connection(self) -> bool:
        """Verify the connection and credentials."""
        pass

    @abstractmethod
    async def get_profile(self) -> UserProfile:
        """Retrieve the user profile."""
        pass

    @abstractmethod
    async def get_funds(self) -> dict[str, Any]:
        """Retrieve available trading funds."""
        pass

    @abstractmethod
    async def get_holdings(self) -> list[dict[str, Any]]:
        """Retrieve portfolio holdings."""
        pass

    @abstractmethod
    async def get_positions(self) -> list[dict[str, Any]]:
        """Retrieve open positions."""
        pass

    @abstractmethod
    async def get_orderbook(self) -> list[dict[str, Any]]:
        """Retrieve the daily order book."""
        pass

    @abstractmethod
    async def get_instruments(self, symbol: str) -> list[dict[str, Any]]:
        """Retrieve active instruments for a given symbol."""
        pass

    @abstractmethod
    async def get_historical_data(
        self, symbol: str, from_date: str, to_date: str, resolution: str
    ) -> list[dict[str, Any]]:
        """Retrieve historical OHLCV data."""
        pass

    @abstractmethod
    async def close(self) -> None:
        """Close any open connections or sessions."""
        pass

    @abstractmethod
    def get_market_stream(self) -> Any:
        """Return the live tick-stream manager for this session."""
        pass
