"""Fyers broker service implementation."""

import asyncio
from typing import Any, cast

from fyers_apiv3 import fyersModel

from app.core.exceptions import BrokerAuthError, BrokerConnectionError
from app.models.user import TradingMode, UserProfile
from app.services.broker_base import BrokerService


class FyersService(BrokerService):
    """Service for interacting with Fyers API."""

    def __init__(
        self,
        app_id: str,
        access_token: str,
        trading_mode: TradingMode = TradingMode.PAPER,
        account_name: str = "Default",
    ):
        super().__init__(trading_mode, account_name)
        self.app_id = app_id
        self.access_token = access_token
        self.client = fyersModel.FyersModel(
            client_id=self.app_id, token=self.access_token, is_async=False, log_path=""
        )

    async def verify_connection(self) -> bool:
        """Verify the Fyers connection by fetching profile."""
        try:
            # We must run this in a threadpool if it's synchronous, but fyersModel might block.
            # For simplicity, assuming fast response.
            response = await asyncio.to_thread(self.client.get_profile)
            if response and response.get('s') == 'ok':
                return True
            raise BrokerAuthError(f"Fyers authentication failed: {response}")
        except Exception as e:
            raise BrokerConnectionError(f"Cannot connect to Fyers: {e}") from e

    async def get_profile(self) -> UserProfile:
        try:
            response = await asyncio.to_thread(self.client.get_profile)
            if response and response.get('s') == 'ok':
                data = response['data']
                return UserProfile(
                    client_id=data.get("fy_id", "unknown"),
                    broker_name="Fyers",
                    trading_mode=self.trading_mode,
                    account_name=self.account_name,
                    funds=None,
                )
            raise BrokerAuthError(f"Failed to get profile: {response}")
        except Exception as e:
            raise BrokerConnectionError(f"Failed to retrieve profile: {e}") from e

    async def get_funds(self) -> dict[str, Any]:
        try:
            response = await asyncio.to_thread(self.client.funds)
            if response and response.get('s') == 'ok':
                return cast(dict[str, Any], response.get('fund_limit', []))
            raise BrokerConnectionError(f"Failed to retrieve funds: {response}")
        except Exception as e:
            raise BrokerConnectionError(f"Failed to retrieve funds: {e}") from e

    async def get_holdings(self) -> list[dict[str, Any]]:
        try:
            response = await asyncio.to_thread(self.client.holdings)
            if response and response.get('s') == 'ok':
                return cast(list[dict[str, Any]], response.get('holdings', []))
            raise BrokerConnectionError(f"Failed to retrieve holdings: {response}")
        except Exception as e:
            raise BrokerConnectionError(f"Failed to retrieve holdings: {e}") from e

    async def get_positions(self) -> list[dict[str, Any]]:
        try:
            response = await asyncio.to_thread(self.client.positions)
            if response and response.get('s') == 'ok':
                return cast(list[dict[str, Any]], response.get('netPositions', []))
            raise BrokerConnectionError(f"Failed to retrieve positions: {response}")
        except Exception as e:
            raise BrokerConnectionError(f"Failed to retrieve positions: {e}") from e

    async def get_orderbook(self) -> list[dict[str, Any]]:
        try:
            response = await asyncio.to_thread(self.client.orderbook)
            if response and response.get('s') == 'ok':
                return cast(list[dict[str, Any]], response.get('orderBook', []))
            raise BrokerConnectionError(f"Failed to retrieve orderbook: {response}")
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
