"""OpenAlgo broker abstraction service.

Wraps the OpenAlgo Python SDK to provide a clean interface for broker
operations. Handles connection verification, profile retrieval, and
fund queries across all supported Indian brokers.
"""

from typing import Any

import httpx

from app.core.exceptions import OpenAlgoAuthError, OpenAlgoConnectionError
from app.models.user import TradingMode, UserProfile


class OpenAlgoService:
    """Service for interacting with an OpenAlgo instance.

    Provides methods to verify connections, authenticate with API keys,
    and retrieve broker account information.

    Attributes:
        host: The OpenAlgo instance URL.
        api_key: The API key for authentication.
        trading_mode: Paper or live trading mode.
    """

    def __init__(
        self,
        host: str,
        api_key: str,
        trading_mode: TradingMode = TradingMode.PAPER,
    ) -> None:
        self.host = host.rstrip("/")
        self.api_key = api_key
        self.trading_mode = trading_mode
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create the HTTP client."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self.host,
                timeout=10.0,
                headers={"Content-Type": "application/json"},
            )
        return self._client

    async def close(self) -> None:
        """Close the HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    async def verify_connection(self) -> bool:
        """Verify that the OpenAlgo instance is reachable and the API key is valid.

        Returns:
            True if connection is successful and API key is valid.

        Raises:
            OpenAlgoConnectionError: If the OpenAlgo instance is unreachable.
            OpenAlgoAuthError: If the API key is invalid.
        """
        try:
            client = await self._get_client()

            # First, check if OpenAlgo is reachable
            response = await client.post(
                "/api/v1/funds",
                json={"apikey": self.api_key},
            )

            if response.status_code == 401:
                raise OpenAlgoAuthError("Invalid OpenAlgo API key")

            if response.status_code == 403:
                raise OpenAlgoAuthError(
                    "API key does not have required permissions"
                )

            if response.status_code >= 500:
                raise OpenAlgoConnectionError(
                    f"OpenAlgo server error: HTTP {response.status_code}"
                )

            # Successful response means connection and auth are valid
            return response.status_code == 200

        except httpx.ConnectError as e:
            raise OpenAlgoConnectionError(
                f"Cannot connect to OpenAlgo at {self.host}: {e}"
            ) from e
        except httpx.TimeoutException as e:
            raise OpenAlgoConnectionError(
                f"Connection to OpenAlgo at {self.host} timed out"
            ) from e
        except (OpenAlgoConnectionError, OpenAlgoAuthError):
            raise
        except Exception as e:
            raise OpenAlgoConnectionError(
                f"Unexpected error connecting to OpenAlgo: {e}"
            ) from e

    async def get_profile(self) -> UserProfile:
        """Retrieve the user profile from OpenAlgo.

        Returns:
            UserProfile with broker and account information.

        Raises:
            OpenAlgoConnectionError: If connection fails.
            OpenAlgoAuthError: If authentication fails.
        """
        # Verify connection first
        await self.verify_connection()

        try:
            client = await self._get_client()

            # Get funds to extract broker info
            funds_response = await client.post(
                "/api/v1/funds",
                json={"apikey": self.api_key},
            )
            funds_data: dict[str, Any] = funds_response.json()

            # Extract profile from available data
            # OpenAlgo's funds endpoint returns broker-specific data
            return UserProfile(
                client_id=funds_data.get("clientid", "unknown"),
                broker_name=funds_data.get("broker", "OpenAlgo"),
                trading_mode=self.trading_mode,
                openalgo_host=self.host,
                funds=funds_data if funds_response.status_code == 200 else None,
            )

        except (OpenAlgoConnectionError, OpenAlgoAuthError):
            raise
        except Exception as e:
            raise OpenAlgoConnectionError(
                f"Failed to retrieve profile: {e}"
            ) from e

    async def get_funds(self) -> dict[str, Any]:
        """Retrieve available trading funds.

        Returns:
            Dictionary with fund details from the broker.

        Raises:
            OpenAlgoConnectionError: If connection fails.
            OpenAlgoAuthError: If authentication fails.
        """
        try:
            client = await self._get_client()

            response = await client.post(
                "/api/v1/funds",
                json={"apikey": self.api_key},
            )

            if response.status_code != 200:
                raise OpenAlgoConnectionError(
                    f"Failed to retrieve funds: HTTP {response.status_code}"
                )

            result: dict[str, Any] = response.json()
            return result

        except (OpenAlgoConnectionError, OpenAlgoAuthError):
            raise
        except Exception as e:
            raise OpenAlgoConnectionError(
                f"Failed to retrieve funds: {e}"
            ) from e

    async def get_instruments(self, symbol: str) -> list[dict[str, Any]]:
        """Retrieve available instruments for a given symbol.

        This method attempts to fetch contracts from OpenAlgo. If the endpoint
        is not yet implemented or standard, it will return a mocked subset
        to allow UI development to proceed.

        Args:
            symbol: The underlying symbol (e.g., 'NIFTY', 'BANKNIFTY').

        Returns:
            A list of dictionary representations of instruments.

        Raises:
            OpenAlgoConnectionError: If connection fails.
            OpenAlgoAuthError: If authentication fails.
        """
        await self.verify_connection()
        try:
            client = await self._get_client()

            # Attempt to fetch from an OpenAlgo instruments endpoint
            # Note: The actual endpoint path may vary based on OpenAlgo's exact API spec.
            response = await client.get(
                f"/api/v1/instruments?symbol={symbol}",
                headers={"Authorization": f"Bearer {self.api_key}"} # Some broker configs in OA use headers or params
            )

            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list):
                    return data
                elif isinstance(data, dict) and "instruments" in data:
                    return data["instruments"]

            # If the endpoint doesn't exist (e.g. 404) or isn't populated,
            # we provide mocked data for UI development of the option chain.
            return self._generate_mock_instruments(symbol)

        except Exception as e:
            # Fallback to mock data for development if the connection fails or isn't supported yet
            return self._generate_mock_instruments(symbol)

    def _generate_mock_instruments(self, symbol: str) -> list[dict[str, Any]]:
        """Generate mock instrument data for development purposes."""
        import datetime
        
        instruments = []
        today = datetime.date.today()
        # Next 3 thursdays for expiries
        expiries = []
        current = today
        while len(expiries) < 3:
            if current.weekday() == 3: # Thursday
                expiries.append(current.strftime("%d-%b-%Y").upper())
            current += datetime.timedelta(days=1)
            
        base_strike = 22000 if symbol == "NIFTY" else 48000
        step = 50 if symbol == "NIFTY" else 100
        
        for expiry in expiries:
            for i in range(-10, 11):
                strike = base_strike + (i * step)
                for opt_type in ["CE", "PE"]:
                    trading_symbol = f"{symbol}{expiry}{strike}{opt_type}"
                    instruments.append({
                        "trading_symbol": trading_symbol,
                        "symbol": symbol,
                        "instrument_type": "OPTIDX",
                        "expiry": expiry,
                        "strike": strike,
                        "option_type": opt_type,
                        "exchange": "NFO"
                    })
        return instruments

    async def get_historical_data(
        self, symbol: str, from_date: str, to_date: str, resolution: str = "1"
    ) -> list[dict[str, Any]]:
        """Retrieve historical OHLCV data.

        This method attempts to fetch historical data from OpenAlgo. If the endpoint
        is not yet implemented or standard, it will return a mocked subset
        to allow backend and DB development to proceed.

        Args:
            symbol: The trading symbol (e.g., 'NIFTY24JUL22000CE').
            from_date: Start date (YYYY-MM-DD).
            to_date: End date (YYYY-MM-DD).
            resolution: Resolution in minutes (default '1').

        Returns:
            A list of dictionary representations of OHLCV candles.

        Raises:
            OpenAlgoConnectionError: If connection fails.
            OpenAlgoAuthError: If authentication fails.
        """
        await self.verify_connection()
        try:
            client = await self._get_client()

            response = await client.get(
                f"/api/v1/historical?symbol={symbol}&from={from_date}&to={to_date}&resolution={resolution}",
                headers={"Authorization": f"Bearer {self.api_key}"}
            )

            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list):
                    return data
                elif isinstance(data, dict) and "data" in data:
                    return data["data"]

            return self._generate_mock_historical_data(symbol, from_date, to_date, resolution)

        except Exception:
            return self._generate_mock_historical_data(symbol, from_date, to_date, resolution)

    def _generate_mock_historical_data(
        self, symbol: str, from_date: str, to_date: str, resolution: str
    ) -> list[dict[str, Any]]:
        """Generate mock historical OHLCV data for development purposes."""
        import datetime
        import random

        try:
            start = datetime.datetime.strptime(from_date, "%Y-%m-%d")
            end = datetime.datetime.strptime(to_date, "%Y-%m-%d")
        except ValueError:
            start = datetime.datetime.now() - datetime.timedelta(days=1)
            end = datetime.datetime.now()

        # Generate 1-minute candles between 9:15 AM and 3:30 PM for each business day
        candles = []
        current_day = start.date()
        end_day = end.date()
        
        base_price = 100.0

        while current_day <= end_day:
            if current_day.weekday() < 5:  # Monday to Friday
                current_time = datetime.datetime.combine(current_day, datetime.time(9, 15))
                end_time = datetime.datetime.combine(current_day, datetime.time(15, 30))
                
                while current_time <= end_time:
                    open_price = base_price
                    high_price = open_price + random.uniform(0, 5)
                    low_price = open_price - random.uniform(0, 5)
                    close_price = random.uniform(low_price, high_price)
                    
                    # Convert to UTC string format
                    # TimescaleDB expects standard datetime or timestamp format
                    timestamp_str = current_time.replace(tzinfo=datetime.timezone.utc).isoformat()
                    
                    candles.append({
                        "timestamp": timestamp_str,
                        "open": round(open_price, 2),
                        "high": round(high_price, 2),
                        "low": round(low_price, 2),
                        "close": round(close_price, 2),
                        "volume": random.randint(100, 10000),
                        "open_interest": random.randint(1000, 50000),
                    })
                    
                    base_price = close_price
                    current_time += datetime.timedelta(minutes=int(resolution))
            
            current_day += datetime.timedelta(days=1)

        return candles
