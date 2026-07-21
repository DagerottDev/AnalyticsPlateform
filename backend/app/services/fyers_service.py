"""Fyers broker service implementation."""

import asyncio
import random
import time
from datetime import UTC, datetime
from typing import Any, cast

from fyers_apiv3 import fyersModel

from app.core.exceptions import BrokerAuthError, BrokerConnectionError
from app.models.user import TradingMode, UserProfile
from app.services.broker_base import BrokerService
from app.services.fyers_market_stream import FyersMarketStreamManager

# Fyers' option-chain endpoint expects exchange-qualified underlying symbols,
# not the plain index names the UI uses.
_INDEX_SYMBOL_MAP = {
    "NIFTY": "NSE:NIFTY50-INDEX",
    "BANKNIFTY": "NSE:NIFTYBANK-INDEX",
    "FINNIFTY": "NSE:FINNIFTY-INDEX",
    "MIDCPNIFTY": "NSE:MIDCPNIFTY-INDEX",
}
_REVERSE_INDEX_SYMBOL_MAP = {v: k for k, v in _INDEX_SYMBOL_MAP.items()}


def to_fyers_ws_symbol(symbol: str) -> str:
    """Map a UI symbol to what Fyers' websocket subscribe protocol expects.

    Option/equity trading symbols (e.g. "NSE:NIFTY2681823200PE") come from
    the REST instrument list already exchange-qualified and pass through
    unchanged; bare underlying symbols (NIFTY, RELIANCE, ...) — used for the
    underlying's own live price — get mapped the same way the option-chain
    REST calls do. Without this, Fyers rejects a bare "NIFTY" subscribe with
    "Please provide a valid symbol".
    """
    if ":" in symbol:
        return symbol
    return FyersService._to_fyers_symbol(symbol)


def from_fyers_ws_symbol(fyers_symbol: str) -> str:
    """Reverse of to_fyers_ws_symbol, for translating an incoming tick's
    symbol back to whatever bare alias the frontend subscribed with. Option
    contract trading symbols aren't bare aliases of anything, so they pass
    through unchanged.
    """
    if fyers_symbol in _REVERSE_INDEX_SYMBOL_MAP:
        return _REVERSE_INDEX_SYMBOL_MAP[fyers_symbol]
    if fyers_symbol.startswith("NSE:") and fyers_symbol.endswith("-EQ"):
        return fyers_symbol[len("NSE:") : -len("-EQ")]
    return fyers_symbol


class FyersService(BrokerService):
    """Service for interacting with Fyers API."""

    # Fyers' optionchain endpoint returns one expiry's chain per call (plus
    # the full expiry list every time) — these bound how many expiries/strikes
    # get_instruments fetches so it stays fast and doesn't hammer rate limits
    # on symbols with many months of listed expiries.
    _MAX_EXPIRIES_FETCHED = 6
    _DEFAULT_STRIKE_COUNT = 20
    _INSTRUMENTS_CACHE_TTL_SECONDS = 30

    # Fyers' optionchain endpoint rate-limits aggressively (observed 429s from
    # well under 20 calls/sec). A single get_instruments fetch is itself
    # 1 + _MAX_EXPIRIES_FETCHED calls, so transient 429/5xx responses are
    # retried with backoff rather than failing the whole request.
    _MAX_FETCH_RETRIES = 3
    _RETRY_BASE_DELAY_SECONDS = 1.5
    _RETRYABLE_CODES = {429, 500, 502, 503, 504}

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
        # symbol -> (fetched_at_monotonic, instruments). The chain and
        # expiries endpoints are both called back-to-back for the same
        # symbol on page load, so this avoids doubling the Fyers API calls.
        self._instruments_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}
        # symbol -> lock, so concurrent requests for the same symbol (e.g.
        # /instruments and /expiries firing together on page load) coalesce
        # into a single fetch instead of each independently bursting
        # 1 + _MAX_EXPIRIES_FETCHED calls at Fyers at the same moment.
        self._instruments_locks: dict[str, asyncio.Lock] = {}
        self._market_stream: FyersMarketStreamManager | None = None

    def get_market_stream(self) -> FyersMarketStreamManager:
        """Lazily create the live tick stream for this session. Callers
        must not call this for a mock session — check is_mock first."""
        if self._market_stream is None:
            self._market_stream = FyersMarketStreamManager(self.app_id, self.access_token)
        return self._market_stream

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

    @staticmethod
    def _to_fyers_symbol(symbol: str) -> str:
        """Map a UI symbol (NIFTY, RELIANCE, ...) to Fyers' option-chain
        underlying format — indices use their exchange INDEX symbol,
        everything else is treated as an NSE equity."""
        upper = symbol.upper()
        return _INDEX_SYMBOL_MAP.get(upper, f"NSE:{upper}-EQ")

    async def _fetch_option_chain(
        self, symbol: str, strikecount: int, expiry_timestamp: str = ""
    ) -> dict[str, Any]:
        """Call Fyers' optionchain endpoint for one expiry (or the nearest,
        if expiry_timestamp is empty). Every response includes `expiryData`
        — the full list of available expiries — regardless of which
        expiry's chain was requested.

        Retries with backoff on 429/5xx — Fyers rate-limits this endpoint
        tightly, and get_instruments makes several of these calls per symbol.
        """
        payload = {
            "symbol": self._to_fyers_symbol(symbol),
            "strikecount": strikecount,
            "timestamp": expiry_timestamp,
        }
        last_response: dict[str, Any] = {}
        for attempt in range(self._MAX_FETCH_RETRIES):
            response = await asyncio.to_thread(self.client.optionchain, payload)
            if response and response.get("s") == "ok":
                return cast(dict[str, Any], response.get("data", {}))
            last_response = response or {}
            is_last_attempt = attempt == self._MAX_FETCH_RETRIES - 1
            if last_response.get("code") not in self._RETRYABLE_CODES or is_last_attempt:
                break
            delay = self._RETRY_BASE_DELAY_SECONDS * (2**attempt) + random.uniform(0, 0.5)
            await asyncio.sleep(delay)
        raise BrokerConnectionError(f"Fyers option chain request failed: {last_response}")

    async def get_instruments(self, symbol: str) -> list[dict[str, Any]]:
        """Fetch option contracts for a symbol across its near-term expiries.

        Fyers' optionchain endpoint returns one expiry's chain per call, so
        this makes one cheap call to discover expiries (`expiryData`) via
        `_fetch_option_chain`, then one call per near-term expiry to build a
        flat instrument list — the shape the frontend expects (all expiries
        merged, filtered client-side by the selected one).
        """
        if self.is_mock:
            return []

        cache_key = symbol.upper()
        cached = self._instruments_cache.get(cache_key)
        if cached and (time.monotonic() - cached[0]) < self._INSTRUMENTS_CACHE_TTL_SECONDS:
            return cached[1]

        lock = self._instruments_locks.setdefault(cache_key, asyncio.Lock())
        async with lock:
            # Re-check: a concurrent caller may have populated the cache
            # while we were waiting on the lock.
            cached = self._instruments_cache.get(cache_key)
            if cached and (time.monotonic() - cached[0]) < self._INSTRUMENTS_CACHE_TTL_SECONDS:
                return cached[1]

            try:
                first = await self._fetch_option_chain(symbol, strikecount=1)
            except Exception as e:
                raise BrokerConnectionError(f"Failed to fetch option chain expiries: {e}") from e

            is_index = symbol.upper() in _INDEX_SYMBOL_MAP
            instruments: list[dict[str, Any]] = []

            for entry in first.get("expiryData", [])[: self._MAX_EXPIRIES_FETCHED]:
                timestamp = str(entry.get("expiry") or "")
                if not timestamp:
                    continue
                try:
                    expiry_label = datetime.fromtimestamp(int(timestamp), tz=UTC).strftime(
                        "%d-%b-%Y"
                    )
                except (ValueError, OSError):
                    continue

                try:
                    chain = await self._fetch_option_chain(
                        symbol, strikecount=self._DEFAULT_STRIKE_COUNT, expiry_timestamp=timestamp
                    )
                except Exception:
                    # Skip an expiry Fyers fails to return (even after
                    # retries) rather than failing the whole request.
                    continue

                for row in chain.get("optionsChain", []):
                    option_type = row.get("option_type")
                    if option_type not in ("CE", "PE"):
                        continue  # The underlying/index row has option_type "".
                    instruments.append(
                        {
                            "trading_symbol": row["symbol"],
                            "symbol": symbol.upper(),
                            "instrument_type": "OPTIDX" if is_index else "OPTSTK",
                            "expiry": expiry_label,
                            "strike": row.get("strike_price"),
                            "option_type": option_type,
                            "exchange": "NFO",
                        }
                    )

            self._instruments_cache[cache_key] = (time.monotonic(), instruments)
            return instruments

    async def get_historical_data(
        self, symbol: str, from_date: str, to_date: str, resolution: str
    ) -> list[dict[str, Any]]:
        """Fetch historical OHLCV candles from Fyers.

        Args:
            symbol: Exchange-qualified symbol, e.g. "NSE:NIFTY50-INDEX".
            from_date: "YYYY-MM-DD", start of range (inclusive).
            to_date: "YYYY-MM-DD", end of range (inclusive).
            resolution: Candle resolution, e.g. "1" (1-minute) or "D" (daily).

        Returns:
            Rows shaped for MarketData insertion. Fyers' history endpoint
            does not return historical open interest, so open_interest is
            always 0 here (a real limitation of the upstream API, not a stub).
        """
        if self.is_mock:
            return []
        try:
            response = await asyncio.to_thread(
                self.client.history,
                {
                    "symbol": symbol,
                    "resolution": resolution,
                    "date_format": 1,
                    "range_from": from_date,
                    "range_to": to_date,
                    "cont_flag": 0,
                },
            )
            if response and response.get('s') == 'ok':
                candles = response.get('candles', [])
                return [
                    {
                        "timestamp": datetime.fromtimestamp(candle[0], tz=UTC),
                        "open": candle[1],
                        "high": candle[2],
                        "low": candle[3],
                        "close": candle[4],
                        "volume": int(candle[5]),
                        "open_interest": 0,
                    }
                    for candle in candles
                ]
            # 'no_data' is a legitimate "no candles in this range" response
            # (e.g. a holiday or a range before the symbol's listing date),
            # not an error.
            if response and response.get('s') == 'no_data':
                return []
            raise BrokerConnectionError(f"Failed to retrieve history for {symbol}: {response}")
        except BrokerConnectionError:
            raise
        except Exception as e:
            raise BrokerConnectionError(f"Failed to retrieve history for {symbol}: {e}") from e

    async def close(self) -> None:
        if self._market_stream is not None:
            # close_connection() joins the socket's background threads —
            # blocking, so keep it off the event loop.
            await asyncio.to_thread(self._market_stream.close)
            self._market_stream = None
