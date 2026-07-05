"""Zerodha Kite broker service implementation."""

from typing import Any
import asyncio

from kiteconnect import KiteConnect

from app.core.exceptions import OpenAlgoAuthError, OpenAlgoConnectionError
from app.models.user import TradingMode, UserProfile
from app.services.broker_base import BrokerService


class ZerodhaService(BrokerService):
    """Service for interacting with Zerodha Kite Connect API."""

    def __init__(
        self,
        api_key: str,
        access_token: str,
        trading_mode: TradingMode = TradingMode.PAPER,
        account_name: str = "Default",
    ):
        super().__init__(trading_mode, account_name)
        self.api_key = api_key
        self.access_token = access_token
        self.client = KiteConnect(api_key=self.api_key)
        self.client.set_access_token(self.access_token)

    async def verify_connection(self) -> bool:
        """Verify the Zerodha connection by fetching profile."""
        try:
            profile = await asyncio.to_thread(self.client.profile)
            if profile:
                return True
            raise OpenAlgoAuthError("Zerodha authentication failed")
        except Exception as e:
            raise OpenAlgoConnectionError(f"Cannot connect to Zerodha: {e}") from e

    async def get_profile(self) -> UserProfile:
        try:
            profile = await asyncio.to_thread(self.client.profile)
            return UserProfile(
                client_id=profile.get("user_id", "unknown"),
                broker_name="Zerodha",
                trading_mode=self.trading_mode,
                account_name=self.account_name,
                funds=None,
            )
        except Exception as e:
            raise OpenAlgoConnectionError(f"Failed to retrieve profile: {e}") from e

    async def get_funds(self) -> dict[str, Any]:
        try:
            margins = await asyncio.to_thread(self.client.margins)
            return margins.get('equity', {})
        except Exception as e:
            raise OpenAlgoConnectionError(f"Failed to retrieve funds: {e}") from e

    async def get_holdings(self) -> list[dict[str, Any]]:
        try:
            return await asyncio.to_thread(self.client.holdings)
        except Exception as e:
            raise OpenAlgoConnectionError(f"Failed to retrieve holdings: {e}") from e

    async def get_positions(self) -> list[dict[str, Any]]:
        try:
            positions = await asyncio.to_thread(self.client.positions)
            return positions.get("net", [])
        except Exception as e:
            raise OpenAlgoConnectionError(f"Failed to retrieve positions: {e}") from e

    async def get_orderbook(self) -> list[dict[str, Any]]:
        try:
            return await asyncio.to_thread(self.client.orders)
        except Exception as e:
            raise OpenAlgoConnectionError(f"Failed to retrieve orderbook: {e}") from e

    async def get_instruments(self, symbol: str) -> list[dict[str, Any]]:
        return []
        
    async def get_historical_data(self, symbol: str, from_date: str, to_date: str, resolution: str) -> list[dict[str, Any]]:
        return []

    async def close(self) -> None:
        pass
