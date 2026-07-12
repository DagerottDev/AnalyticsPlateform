"""Zerodha Kite broker service implementation."""

import asyncio
from typing import Any, cast

from kiteconnect import KiteConnect

from app.core.exceptions import BrokerAuthError, BrokerConnectionError
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
        self.is_mock = access_token.startswith("mock")
        if not self.is_mock:
            self.client = KiteConnect(api_key=self.api_key)
            self.client.set_access_token(self.access_token)

    async def verify_connection(self) -> bool:
        """Verify the Zerodha connection by fetching profile."""
        if self.is_mock:
            return True
        try:
            profile = await asyncio.to_thread(self.client.profile)
            if profile:
                return True
            raise BrokerAuthError("Zerodha authentication failed")
        except Exception as e:
            raise BrokerConnectionError(f"Cannot connect to Zerodha: {e}") from e

    async def get_profile(self) -> UserProfile:
        if self.is_mock:
            return UserProfile(
                client_id="MOCK_USER",
                broker_name="Zerodha",
                trading_mode=self.trading_mode,
                account_name=self.account_name,
                funds=None,
            )
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
            raise BrokerConnectionError(f"Failed to retrieve profile: {e}") from e

    async def get_funds(self) -> dict[str, Any]:
        if self.is_mock:
            return {"available": {"cash": 1000000.0}}
        try:
            margins = await asyncio.to_thread(self.client.margins)
            return cast(dict[str, Any], margins.get('equity', {}))
        except Exception as e:
            raise BrokerConnectionError(f"Failed to retrieve funds: {e}") from e

    async def get_holdings(self) -> list[dict[str, Any]]:
        if self.is_mock:
            return [
                {
                    "tradingsymbol": "RELIANCE",
                    "quantity": 10,
                    "average_price": 2450.0,
                    "last_price": 2480.0,
                    "pnl": 300.0,
                }
            ]
        try:
            return await asyncio.to_thread(self.client.holdings)
        except Exception as e:
            raise BrokerConnectionError(f"Failed to retrieve holdings: {e}") from e

    async def get_positions(self) -> list[dict[str, Any]]:
        if self.is_mock:
            return [
                {
                    "tradingsymbol": "NIFTY2671624300CE",
                    "quantity": 50,
                    "average_price": 120.0,
                    "last_price": 135.0,
                    "pnl": 750.0,
                }
            ]
        try:
            positions = await asyncio.to_thread(self.client.positions)
            return cast(list[dict[str, Any]], positions.get("net", []))
        except Exception as e:
            raise BrokerConnectionError(f"Failed to retrieve positions: {e}") from e

    async def get_orderbook(self) -> list[dict[str, Any]]:
        if self.is_mock:
            return [
                {
                    "order_id": "123456789",
                    "tradingsymbol": "RELIANCE",
                    "quantity": 10,
                    "price": 2450.0,
                    "order_type": "LIMIT",
                    "transaction_type": "BUY",
                    "status": "COMPLETE",
                }
            ]
        try:
            return await asyncio.to_thread(self.client.orders)
        except Exception as e:
            raise BrokerConnectionError(f"Failed to retrieve orderbook: {e}") from e

    async def get_instruments(self, symbol: str) -> list[dict[str, Any]]:
        return []

    async def get_historical_data(
        self, symbol: str, from_date: str, to_date: str, resolution: str
    ) -> list[dict[str, Any]]:
        return []

    async def close(self) -> None:
        pass
