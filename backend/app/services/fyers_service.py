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
        # Fyers API v3 requires the appType (-100) suffix on the client_id
        self.app_id = app_id if app_id.endswith("-100") else f"{app_id}-100"
        self.access_token = access_token
        self.is_mock = access_token.startswith("mock")
        if not self.is_mock:
            self.client = fyersModel.FyersModel(
                client_id=self.app_id, token=self.access_token, is_async=False, log_path=""
            )

    async def verify_connection(self) -> bool:
        """Verify the Fyers connection by fetching profile."""
        if self.is_mock:
            return True
        try:
            response = await asyncio.to_thread(self.client.get_profile)
            if response and response.get('s') == 'ok':
                return True
            raise BrokerAuthError(f"Fyers authentication failed: {response}")
        except Exception as e:
            raise BrokerConnectionError(f"Cannot connect to Fyers: {e}") from e

    async def get_profile(self) -> UserProfile:
        if self.is_mock:
            return UserProfile(
                client_id="MOCK_FY_ID",
                broker_name="Fyers",
                trading_mode=self.trading_mode,
                account_name=self.account_name,
                funds=None,
            )
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
        if self.is_mock:
            return {"availableBalance": 1000000.0, "realisedPNL": 0.0}
        try:
            response = await asyncio.to_thread(self.client.funds)
            if response and response.get('s') == 'ok':
                return cast(dict[str, Any], response.get('fund_limit', []))
            raise BrokerConnectionError(f"Failed to retrieve funds: {response}")
        except Exception as e:
            raise BrokerConnectionError(f"Failed to retrieve funds: {e}") from e

    async def get_holdings(self) -> list[dict[str, Any]]:
        if self.is_mock:
            return [
                {
                    "symbol": "NSE:RELIANCE-EQ",
                    "quantity": 10,
                    "avgPrice": 2450.0,
                    "marketVal": 24800.0,
                    "pl": 300.0,
                }
            ]
        try:
            response = await asyncio.to_thread(self.client.holdings)
            if response and response.get('s') == 'ok':
                return cast(list[dict[str, Any]], response.get('holdings', []))
            raise BrokerConnectionError(f"Failed to retrieve holdings: {response}")
        except Exception as e:
            raise BrokerConnectionError(f"Failed to retrieve holdings: {e}") from e

    async def get_positions(self) -> list[dict[str, Any]]:
        if self.is_mock:
            return [
                {
                    "symbol": "NSE:NIFTY2671624300CE",
                    "qty": 50,
                    "avgPrice": 120.0,
                    "lastPrice": 135.0,
                    "realized_pl": 0.0,
                    "unrealized_pl": 750.0,
                }
            ]
        try:
            response = await asyncio.to_thread(self.client.positions)
            if response and response.get('s') == 'ok':
                return cast(list[dict[str, Any]], response.get('netPositions', []))
            raise BrokerConnectionError(f"Failed to retrieve positions: {response}")
        except Exception as e:
            raise BrokerConnectionError(f"Failed to retrieve positions: {e}") from e

    async def get_orderbook(self) -> list[dict[str, Any]]:
        if self.is_mock:
            return [
                {
                    "orderId": "123456789",
                    "symbol": "NSE:RELIANCE-EQ",
                    "qty": 10,
                    "price": 2450.0,
                    "type": "LIMIT",
                    "side": "BUY",
                    "status": "FILLED",
                }
            ]
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
