"""Fyers broker service implementation."""

import asyncio
import logging
import time
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from fyers_apiv3 import fyersModel

from app.core.exceptions import BrokerAuthError, BrokerConnectionError, BrokerRateLimitError
from app.core.retry import compute_backoff_delay
from app.models.user import TradingMode, UserProfile
from app.services.broker_base import BrokerService
from app.services.fyers_market_stream import FyersMarketStreamManager
from app.services.fyers_quote_parsing import parse_fyers_quote_row
from app.services.fyers_response_parsing import (
    build_fyers_order_payload,
    fyers_auth_error,
    is_fyers_auth_response,
    parse_fyers_basket_order_response,
    require_fyers_order_success,
)
from app.services.fyers_symbols import (
    INDEX_SYMBOL_MAP,
    from_fyers_ws_symbol,
    to_fyers_option_chain_symbol,
    to_fyers_ws_symbol,
)

logger = logging.getLogger(__name__)

# Re-exported for backward compatibility — some callers still import these
# two directly from this module rather than from fyers_symbols.
__all__ = ["FyersService", "from_fyers_ws_symbol", "to_fyers_ws_symbol"]


class FyersService(BrokerService):
    """Service for interacting with Fyers API."""

    # Fyers' history endpoint accepts exchange-qualified option symbols, so it
    # can provide the optional historical ATM-IV seed used by the screener.
    supports_historical_options = True
    supports_live_fno_symbol_master = True

    # Fyers' optionchain endpoint returns one expiry's chain per call (plus
    # the full expiry list every time) — these bound how many expiries/strikes
    # get_instruments fetches so it stays fast and doesn't hammer rate limits
    # on symbols with many months of listed expiries.
    _MAX_EXPIRIES_FETCHED = 6
    # Request a wide chain per expiry. The UI's "All strikes" setting can
    # only display rows returned by the broker; the previous 20-strike request
    # silently made that setting look incomplete.
    _DEFAULT_STRIKE_COUNT = 50
    # Expiry/contract metadata changes far less often than prices. Keep it for
    # several minutes so opening the Greek workspace does not repeatedly spend
    # the broker's tight option-chain quota.
    _INSTRUMENTS_CACHE_TTL_SECONDS = 5 * 60
    _INSTRUMENTS_RATE_LIMIT_COOLDOWN_SECONDS = 30

    # Fyers' optionchain endpoint rate-limits aggressively (observed 429s from
    # well under 20 calls/sec). A single get_instruments fetch is itself
    # 1 + _MAX_EXPIRIES_FETCHED calls, so transient 429/5xx responses are
    # retried with backoff rather than failing the whole request.
    _MAX_FETCH_RETRIES = 3
    _RETRY_BASE_DELAY_SECONDS = 1.5
    _RETRYABLE_CODES = {429, 500, 502, 503, 504}
    # FYERS uses this non-success response for valid symbols that simply have
    # no active F&O expiry. It is a normal empty-universe result, not a broker
    # connectivity failure (common for symbols in a broad static universe).
    _NO_EXPIRY_CONTRACT_CODE = -470
    _NO_CONTRACT_CACHE_TTL_SECONDS = 10 * 60
    # Fyers occasionally responds with -99/"Bad request" for an otherwise
    # valid option-chain request during expiry rollover or a short request
    # burst. Keep all option-chain calls for a broker session on one cadence
    # and retry that transient response instead of surfacing a false 503.
    _OPTION_CHAIN_REQUEST_MIN_INTERVAL_SECONDS = 0.1
    _OPTION_CHAIN_RETRYABLE_CODES = _RETRYABLE_CODES | {-99}
    # A Greek workspace may request one underlying plus ten option histories
    # at once. FYERS rate-limits the history API independently and those
    # bursts can consume capacity needed by the live quote fallback. Serialize
    # starts with a small gap for every broker session as a final safeguard,
    # even if a client bypasses the UI's limited-concurrency loader.
    _HISTORY_REQUEST_MIN_INTERVAL_SECONDS = 0.25
    # Every consumer (Option Chain, the websocket seed, the stream fallback,
    # strategy workspaces) shares the same broker session. Serializing quote
    # starts prevents their otherwise simultaneous 40-symbol batches from
    # tripping Fyers' /quotes 429 limit and freezing every visible premium.
    _QUOTE_REQUEST_MIN_INTERVAL_SECONDS = 0.12
    _MAX_QUOTE_FETCH_RETRIES = 2

    # Fyers returns these codes for an expired/invalid access token.  Keep the
    # mapping here so every REST path can stop retrying the same dead session.
    _AUTH_ERROR_CODES = {-15, -16, 401, 403}

    # Fyers' margin calculator wants an order `type` (1=Limit, 2=Market, 3=Stop,
    # 4=StopLimit) even though no order is actually placed here — Market
    # gives a same-side-agnostic estimate without needing a limit price.
    _MARGIN_ORDER_TYPE = 2
    _ORDER_TYPE_CODES = {"LIMIT": 1, "MARKET": 2, "STOP": 3, "STOP_LIMIT": 4}
    _ORDER_TYPE_NAMES = {value: key for key, value in _ORDER_TYPE_CODES.items()}
    # Fyers' bulk-placement endpoint caps a single call at this many legs.
    _MAX_BASKET_ORDERS = 10
    # Keep quote requests below the broker's practical batch limit. Option
    # Chain subscribes to one underlying plus many contracts, so sending the
    # whole chain as one quotes request can make Fyers reject the request and
    # leave the UI stuck on its fallback spot price.
    _QUOTE_BATCH_SIZE = 40

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
        self.client = fyersModel.FyersModel(
            client_id=self.app_id, token=self.access_token, is_async=False, log_path=""
        )
        # symbol -> (fetched_at_monotonic, instruments). The chain and
        # expiries endpoints are both called back-to-back for the same
        # symbol on page load, so this avoids doubling the Fyers API calls.
        self._instruments_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}
        self._no_contract_cache: dict[str, float] = {}
        # symbol -> lock, so concurrent requests for the same symbol (e.g.
        # /instruments and /expiries firing together on page load) coalesce
        # into a single fetch instead of each independently bursting
        # 1 + _MAX_EXPIRIES_FETCHED calls at Fyers at the same moment.
        self._instruments_locks: dict[str, asyncio.Lock] = {}
        self._option_chain_request_lock = asyncio.Lock()
        self._next_option_chain_request_at = 0.0
        self._history_request_lock = asyncio.Lock()
        self._next_history_request_at = 0.0
        self._quote_request_lock = asyncio.Lock()
        self._next_quote_request_at = 0.0
        self._market_stream: FyersMarketStreamManager | None = None

    def get_market_stream(
        self, quote_poll_interval_seconds: float = 3.0
    ) -> FyersMarketStreamManager:
        """Lazily create the live tick stream (+ shared REST-quote-poll loop)
        for this session. quote_poll_interval_seconds only takes effect on
        first creation — there's one stream per session, shared by every
        connected websocket."""
        if self._market_stream is None:
            self._market_stream = FyersMarketStreamManager(
                self.app_id,
                self.access_token,
                quote_fetcher=self.get_quotes,
                quote_poll_interval_seconds=quote_poll_interval_seconds,
            )
        return self._market_stream

    async def get_profile(self) -> UserProfile:
        try:
            response = await asyncio.to_thread(self.client.get_profile)
            if response and response.get('s') == 'ok':
                data = response['data']
                real_name = (
                    data.get("name")
                    or data.get("display_name")
                    or data.get("fy_id")
                    or self.account_name
                )
                return UserProfile(
                    client_id=data.get("fy_id", "unknown"),
                    broker_name="Fyers",
                    trading_mode=self.trading_mode,
                    account_name=real_name,
                    funds=None,
                )
            if is_fyers_auth_response(response, self._AUTH_ERROR_CODES):
                raise fyers_auth_error(response, "profile")
            raise BrokerConnectionError(f"Failed to retrieve profile: {response}")
        except (BrokerAuthError, BrokerConnectionError):
            raise
        except Exception as e:
            raise BrokerConnectionError(f"Failed to retrieve profile: {e}") from e

    async def get_quotes(self, symbols: list[str]) -> list[dict[str, Any]]:
        """Fetch live quotes for a list of symbols from Fyers REST API."""
        if not symbols:
            return []

        # Fyers may reject a large option-chain quote request as a whole. Run
        # bounded requests sequentially so one rejected batch cannot hide the
        # underlying quote or the successful contracts in other batches.
        if len(symbols) > self._QUOTE_BATCH_SIZE:
            quotes: list[dict[str, Any]] = []
            for start in range(0, len(symbols), self._QUOTE_BATCH_SIZE):
                quotes.extend(
                    await self.get_quotes(symbols[start : start + self._QUOTE_BATCH_SIZE])
                )
            return quotes

        # Callers pass either a bare underlying alias ("NIFTY") or an
        # already-exchange-qualified option/equity trading symbol
        # ("NSE:NIFTY26JUL23000PE") straight from the instrument list —
        # only the former needs the NSE:...-EQ mapping. Using
        # _to_fyers_symbol unconditionally here used to double-wrap the
        # latter into "NSE:NSE:...-EQ", which Fyers rejects.
        fyers_symbols = [to_fyers_ws_symbol(s) for s in symbols]
        try:
            payload = {"symbols": ",".join(fyers_symbols)}
            response: dict[str, Any] | None = None
            for attempt in range(self._MAX_QUOTE_FETCH_RETRIES):
                response = await self._fetch_quotes_with_pacing(payload)
                if response and response.get("s") == "ok":
                    break
                if (
                    not response
                    or response.get("code") != 429
                    or attempt == self._MAX_QUOTE_FETCH_RETRIES - 1
                ):
                    return []
                await asyncio.sleep(compute_backoff_delay(attempt, self._RETRY_BASE_DELAY_SECONDS))

            if not response or response.get("s") != "ok":
                return []

            quotes_list: list[dict[str, Any]] = []
            for item in response.get("d", []):
                parsed = parse_fyers_quote_row(item)
                if parsed is not None:
                    quotes_list.append(parsed)
            return quotes_list
        except Exception as e:
            import logging
            logging.getLogger(__name__).error("Failed to fetch Fyers quotes: %s", e)
            return []

    async def _fetch_quotes_with_pacing(self, payload: dict[str, str]) -> dict[str, Any] | None:
        """Start quote requests at one safe cadence for the broker session."""
        async with self._quote_request_lock:
            now = time.monotonic()
            delay = self._next_quote_request_at - now
            self._next_quote_request_at = max(now, self._next_quote_request_at) + (
                self._QUOTE_REQUEST_MIN_INTERVAL_SECONDS
            )
            if delay > 0:
                await asyncio.sleep(delay)
            return await asyncio.to_thread(self.client.quotes, payload)

    async def _fetch_option_chain(
        self, symbol: str, strikecount: int, expiry_timestamp: str = ""
    ) -> dict[str, Any] | None:
        """Call Fyers' optionchain endpoint for one expiry (or the nearest,
        if expiry_timestamp is empty). Every response includes `expiryData`
        — the full list of available expiries — regardless of which
        expiry's chain was requested.

        Retries with backoff on 429/5xx — Fyers rate-limits this endpoint
        tightly, and get_instruments makes several of these calls per symbol.
        """
        payload = {
            "symbol": to_fyers_option_chain_symbol(symbol),
            "strikecount": strikecount,
            "timestamp": expiry_timestamp,
        }
        last_response: dict[str, Any] = {}
        for attempt in range(self._MAX_FETCH_RETRIES):
            response = await self._fetch_option_chain_with_pacing(payload)
            if response and response.get("s") == "ok":
                return cast(dict[str, Any], response.get("data", {}))
            last_response = response or {}
            if is_fyers_auth_response(last_response, self._AUTH_ERROR_CODES):
                raise fyers_auth_error(last_response, "option chain")
            if last_response.get("code") == self._NO_EXPIRY_CONTRACT_CODE:
                return None
            is_last_attempt = attempt == self._MAX_FETCH_RETRIES - 1
            if (
                last_response.get("code") not in self._OPTION_CHAIN_RETRYABLE_CODES
                or is_last_attempt
            ):
                break
            delay = compute_backoff_delay(attempt, self._RETRY_BASE_DELAY_SECONDS)
            await asyncio.sleep(delay)
        if str(last_response.get("code")) == "429":
            message = str(last_response.get("message") or "request limit reached")
            raise BrokerRateLimitError(
                f"Fyers option chain request rate-limited: {message}",
                retry_after=self._INSTRUMENTS_RATE_LIMIT_COOLDOWN_SECONDS,
            )
        raise BrokerConnectionError(f"Fyers option chain request failed: {last_response}")

    async def _fetch_option_chain_with_pacing(
        self, payload: dict[str, Any]
    ) -> dict[str, Any]:
        """Start option-chain requests on one safe cadence per broker session."""
        async with self._option_chain_request_lock:
            now = time.monotonic()
            delay = self._next_option_chain_request_at - now
            self._next_option_chain_request_at = max(now, self._next_option_chain_request_at) + (
                self._OPTION_CHAIN_REQUEST_MIN_INTERVAL_SECONDS
            )
        if delay > 0:
            await asyncio.sleep(delay)
        return await asyncio.to_thread(self.client.optionchain, payload)

    async def get_instruments(self, symbol: str) -> list[dict[str, Any]]:
        """Fetch option contracts for a symbol across its near-term expiries.

        Fyers' optionchain endpoint returns one expiry's chain per call, so
        this makes one cheap call to discover expiries (`expiryData`) via
        `_fetch_option_chain`, then one call per near-term expiry to build a
        flat instrument list — the shape the frontend expects (all expiries
        merged, filtered client-side by the selected one).
        """
        cache_key = symbol.upper()
        now = time.monotonic()
        no_contract_at = self._no_contract_cache.get(cache_key)
        if no_contract_at and (
            time.monotonic() - no_contract_at
        ) < self._NO_CONTRACT_CACHE_TTL_SECONDS:
            return []
        cached = self._instruments_cache.get(cache_key)
        if cached and (now - cached[0]) < self._INSTRUMENTS_CACHE_TTL_SECONDS:
            return cached[1]

        lock = self._instruments_locks.setdefault(cache_key, asyncio.Lock())
        async with lock:
            # Re-check: a concurrent caller may have populated the cache
            # while we were waiting on the lock.
            cached = self._instruments_cache.get(cache_key)
            now = time.monotonic()
            if cached and (now - cached[0]) < self._INSTRUMENTS_CACHE_TTL_SECONDS:
                return cached[1]

            # No local pre-emptive lockout here — every call is actually sent
            # to Fyers. A prior rate-limit response no longer blocks the next
            # attempt on its own; only a fresh 429 from Fyers (handled below)
            # does that, and only for that one request.
            try:
                first = await self._fetch_option_chain(symbol, strikecount=1)
            except BrokerAuthError:
                raise
            except BrokerRateLimitError:
                if cached and cached[1]:
                    logger.warning(
                        "Fyers option-chain rate limit for %s; serving stale instrument cache",
                        cache_key,
                    )
                    return cached[1]
                raise
            except Exception as e:
                raise BrokerConnectionError(f"Failed to fetch option chain expiries: {e}") from e

            if first is None:
                self._no_contract_cache[cache_key] = time.monotonic()
                self._instruments_cache[cache_key] = (time.monotonic(), [])
                return []

            self._no_contract_cache.pop(cache_key, None)
            is_index = symbol.upper() in INDEX_SYMBOL_MAP
            instruments: list[dict[str, Any]] = []
            rate_limited = False

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
                except BrokerAuthError:
                    raise
                except BrokerRateLimitError:
                    rate_limited = True
                    break
                except Exception:
                    # Skip an expiry Fyers fails to return (even after
                    # retries) rather than failing the whole request.
                    continue

                if chain is None:
                    continue

                for row in chain.get("optionsChain", []):
                    option_type = row.get("option_type")
                    if option_type not in ("CE", "PE"):
                        continue  # The underlying/index row has option_type "".
                    trading_symbol = str(row["symbol"])
                    instruments.append(
                        {
                            "trading_symbol": trading_symbol,
                            "symbol": symbol.upper(),
                            "instrument_type": "OPTIDX" if is_index else "OPTSTK",
                            "expiry": expiry_label,
                            "strike": row.get("strike_price"),
                            "option_type": option_type,
                            "exchange": "BFO" if trading_symbol.startswith("BFO:") else "NFO",
                            "oi": row.get("oi"),
                            "oi_change": row.get("oich"),
                            "oi_change_percent": row.get("oichp"),
                        }
                    )

            if rate_limited:
                if cached and cached[1]:
                    logger.warning(
                        "Fyers option-chain rate limit while refreshing %s; "
                        "serving stale instrument cache",
                        cache_key,
                    )
                    return cached[1]
                raise BrokerRateLimitError(
                    "Fyers option-chain request rate-limited while loading expiries",
                    retry_after=self._INSTRUMENTS_RATE_LIMIT_COOLDOWN_SECONDS,
                )

            self._instruments_cache[cache_key] = (time.monotonic(), instruments)
            return instruments

    # Fyers rejects a single /history call spanning more than 366 days for
    # these resolutions ("Date range cannot exceed 366 days for 1D, 1W, and
    # 1M resolutions"), so multi-year requests must be split into chunks and
    # merged client-side. Intraday resolutions aren't in this map and are
    # left unchunked since callers already keep those ranges small.
    _DAILY_PLUS_RESOLUTIONS = {"D", "1D", "1W", "1M"}
    _MAX_RANGE_DAYS = 366

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
        from_dt = datetime.strptime(from_date, "%Y-%m-%d")
        to_dt = datetime.strptime(to_date, "%Y-%m-%d")

        if (
            resolution in self._DAILY_PLUS_RESOLUTIONS
            and (to_dt - from_dt).days > self._MAX_RANGE_DAYS
        ):
            candles: list[dict[str, Any]] = []
            chunk_start = from_dt
            while chunk_start <= to_dt:
                chunk_end = min(chunk_start + timedelta(days=self._MAX_RANGE_DAYS), to_dt)
                candles.extend(
                    await self._fetch_history_chunk(
                        symbol,
                        chunk_start.strftime("%Y-%m-%d"),
                        chunk_end.strftime("%Y-%m-%d"),
                        resolution,
                    )
                )
                chunk_start = chunk_end + timedelta(days=1)
            return candles

        return await self._fetch_history_chunk(symbol, from_date, to_date, resolution)

    async def _fetch_history_chunk(
        self, symbol: str, from_date: str, to_date: str, resolution: str
    ) -> list[dict[str, Any]]:
        try:
            payload = {
                "symbol": symbol,
                "resolution": resolution,
                "date_format": 1,
                "range_from": from_date,
                "range_to": to_date,
                "cont_flag": 0,
            }
            last_response: dict[str, Any] = {}
            for attempt in range(self._MAX_FETCH_RETRIES):
                response = await self._fetch_history_with_pacing(payload)
                if response and response.get("s") == "ok":
                    candles = response.get("candles", [])
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
                # 'no_data' is a legitimate "no candles in this range"
                # response (for example, a holiday), not an error to retry.
                if response and response.get("s") == "no_data":
                    return []

                last_response = response or {}
                is_last_attempt = attempt == self._MAX_FETCH_RETRIES - 1
                if last_response.get("code") not in self._RETRYABLE_CODES or is_last_attempt:
                    break
                await asyncio.sleep(
                    compute_backoff_delay(attempt, self._RETRY_BASE_DELAY_SECONDS)
                )
            if is_fyers_auth_response(last_response, self._AUTH_ERROR_CODES):
                raise fyers_auth_error(last_response, "history")
            raise BrokerConnectionError(
                f"Failed to retrieve history for {symbol}: {last_response}"
            )
        except BrokerAuthError:
            raise
        except BrokerConnectionError:
            raise
        except Exception as e:
            raise BrokerConnectionError(f"Failed to retrieve history for {symbol}: {e}") from e

    async def _fetch_history_with_pacing(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Start history requests at a safe shared cadence for this broker session."""
        async with self._history_request_lock:
            now = time.monotonic()
            delay = self._next_history_request_at - now
            self._next_history_request_at = max(now, self._next_history_request_at) + (
                self._HISTORY_REQUEST_MIN_INTERVAL_SECONDS
            )
        if delay > 0:
            await asyncio.sleep(delay)
        return await asyncio.to_thread(self.client.history, payload)

    async def get_margin(self, orders: list[dict[str, Any]]) -> dict[str, Any]:
        """Calls Fyers' multi-order margin calculator for a prospective basket
        of orders — no order is actually placed. Each item in `orders`:
        {symbol, quantity, side ("Buy"/"Sell"), product_type}.

        This endpoint isn't wrapped by fyers_apiv3's FyersModel, so it's
        called directly via the SDK's own request plumbing (same
        session/headers/base-URL post_call() uses internally).
        """
        if not orders:
            return {}

        payload = {
            "data": [
                {
                    "symbol": order["symbol"],
                    "qty": abs(int(order["quantity"])),
                    "side": 1 if order["side"].lower() == "buy" else -1,
                    "type": self._MARGIN_ORDER_TYPE,
                    "productType": order.get("product_type") or "MARGIN",
                }
                for order in orders
            ]
        }
        try:
            response = await asyncio.to_thread(
                self.client.service.post_call, "/multiorder/margin", self.client.header, payload
            )
        except Exception as e:
            raise BrokerConnectionError(f"Fyers margin calculator request failed: {e}") from e
        if not response or response.get("s") != "ok":
            raise BrokerConnectionError(f"Fyers margin calculator request failed: {response}")
        return cast(dict[str, Any], response.get("data", {}))

    async def get_positions(self) -> list[dict[str, Any]]:
        """Currently open broker positions (intraday + carry-forward) from
        Fyers' /positions. Includes rows Fyers reports at net-zero quantity
        (squared off earlier today) — callers that only want the live book
        should filter those out themselves rather than losing that
        information here.
        """
        try:
            response = await asyncio.to_thread(self.client.positions)
        except Exception as e:
            raise BrokerConnectionError(f"Failed to retrieve positions: {e}") from e
        if not response or response.get("s") != "ok":
            raise BrokerConnectionError(f"Failed to retrieve positions: {response}")

        positions: list[dict[str, Any]] = []
        for row in response.get("netPositions", []):
            trading_symbol = row.get("symbol", "")
            qty = row.get("netQty", row.get("qty", 0))
            realized = row.get("realized_profit", 0.0)
            unrealized = row.get("unrealized_profit", 0.0)
            positions.append(
                {
                    "trading_symbol": trading_symbol,
                    "symbol": from_fyers_ws_symbol(trading_symbol),
                    "product_type": row.get("productType", ""),
                    "quantity": qty,
                    "side": "Buy" if qty > 0 else "Sell" if qty < 0 else "Flat",
                    "avg_price": row.get("netAvg", row.get("avgPrice", 0.0)),
                    "last_price": row.get("ltp", 0.0),
                    "realized_pnl": realized,
                    "unrealized_pnl": unrealized,
                    "pnl": row.get("pl", realized + unrealized),
                }
            )
        return positions

    async def get_holdings(self) -> list[dict[str, Any]]:
        """Delivery/long-term portfolio holdings from Fyers' /holdings."""
        try:
            response = await asyncio.to_thread(self.client.holdings)
        except Exception as e:
            raise BrokerConnectionError(f"Failed to retrieve holdings: {e}") from e
        if not response or response.get("s") != "ok":
            raise BrokerConnectionError(f"Failed to retrieve holdings: {response}")

        holdings: list[dict[str, Any]] = []
        for row in response.get("holdings", []):
            trading_symbol = row.get("symbol", "")
            holdings.append(
                {
                    "trading_symbol": trading_symbol,
                    "symbol": from_fyers_ws_symbol(trading_symbol),
                    "holding_type": row.get("holdingType", ""),
                    "quantity": row.get("quantity", row.get("qty", 0)),
                    "avg_price": row.get("costPrice", 0.0),
                    "last_price": row.get("ltp", 0.0),
                    "market_value": row.get("marketVal", 0.0),
                    "pnl": row.get("pl", 0.0),
                }
            )
        return holdings

    async def get_funds(self) -> dict[str, Any]:
        """Account funds/margin summary from Fyers' /funds.

        Fyers documents this as a fixed list of titled rows ("Total
        Balance", "Utilized Amount", "Available Balance", ...) rather than a
        flat object, and — like the margin calculator — the exact title
        strings aren't guaranteed stable across API versions, so the raw
        rows are returned as-is here; tolerant title-matching into named
        fields happens at the API layer (see app.api.v1.portfolio), same
        division of labor as get_margin/MarginResponse.
        """
        try:
            response = await asyncio.to_thread(self.client.funds)
        except Exception as e:
            raise BrokerConnectionError(f"Failed to retrieve funds: {e}") from e
        if not response or response.get("s") != "ok":
            raise BrokerConnectionError(f"Failed to retrieve funds: {response}")
        return {"fund_limit": response.get("fund_limit", [])}

    def _require_order_success(
        self, response: dict[str, Any] | None, action: str
    ) -> dict[str, Any]:
        return require_fyers_order_success(response, action, self._AUTH_ERROR_CODES)

    async def get_orders(self) -> list[dict[str, Any]]:
        """Today's order book, normalized without exposing Fyers' raw shape."""
        try:
            response = await asyncio.to_thread(self.client.orderbook)
        except Exception as e:
            raise BrokerConnectionError(f"Failed to retrieve orders: {e}") from e
        response = self._require_order_success(response, "order book")

        orders: list[dict[str, Any]] = []
        for row in response.get("orderBook", response.get("data", [])):
            type_code = row.get("type", 2)
            status = str(row.get("status", row.get("statusMessage", "Unknown")))
            quantity = int(row.get("qty", row.get("quantity", 0)) or 0)
            filled = int(row.get("filledQty", row.get("filledQuantity", 0)) or 0)
            remaining = int(row.get("remainingQuantity", max(quantity - filled, 0)) or 0)
            orders.append(
                {
                    "id": str(row.get("id", "")),
                    "trading_symbol": str(row.get("symbol", "")),
                    "side": "Buy" if int(row.get("side", 1)) == 1 else "Sell",
                    "order_type": self._ORDER_TYPE_NAMES.get(type_code, "MARKET"),
                    "product_type": str(row.get("productType", "")),
                    "quantity": quantity,
                    "filled_quantity": filled,
                    "remaining_quantity": remaining,
                    "average_price": float(
                        row.get("tradedPrice", row.get("avgPrice", row.get("averagePrice", 0))) or 0
                    ),
                    "limit_price": float(row.get("limitPrice", 0) or 0),
                    "stop_price": float(row.get("stopPrice", 0) or 0),
                    "status": status,
                    "status_message": row.get("statusMessage") or row.get("message"),
                    "order_time": row.get("orderDateTime") or row.get("orderTime"),
                    # Echoed back for any order placed with `order_tag` in
                    # _order_payload — lets a caller reconcile an ambiguous
                    # placement failure by searching the order book for the
                    # tag it submitted, rather than by broker-generated id
                    # (which it may never have received). See
                    # order_reconciliation.find_order_by_tag.
                    "order_tag": row.get("orderTag") or None,
                }
            )
        return [order for order in orders if order["id"]]

    def _order_payload(self, order: dict[str, Any]) -> dict[str, Any]:
        """Shared per-order payload shaping for both single and basket placement."""
        return build_fyers_order_payload(order, self._ORDER_TYPE_CODES)

    async def place_order(self, order: dict[str, Any]) -> dict[str, Any]:
        """Submit a request whose shape has already been validated at the API boundary."""
        try:
            response = await asyncio.to_thread(self.client.place_order, self._order_payload(order))
        except Exception as e:
            raise BrokerConnectionError(f"Fyers place order request failed: {e}") from e
        response = self._require_order_success(response, "place order")
        return {
            "id": response.get("id"),
            "message": str(response.get("message", "Order submitted")),
        }

    # Fyers' bulk-placement endpoint (SDK's place_basket_orders -> POST
    # /multi-order/sync) places legs sequentially, returning one result per
    # order in the same order they were submitted. See
    # fyers_response_parsing.parse_fyers_basket_order_response for why that
    # response is parsed tolerantly.
    async def place_basket_orders(self, orders: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if not orders:
            return []
        if len(orders) > self._MAX_BASKET_ORDERS:
            raise BrokerConnectionError(
                f"Fyers basket orders are limited to {self._MAX_BASKET_ORDERS} legs per call"
            )
        payload = [self._order_payload(order) for order in orders]
        try:
            response = await asyncio.to_thread(self.client.place_basket_orders, payload)
        except Exception as e:
            raise BrokerConnectionError(f"Fyers basket order request failed: {e}") from e

        return parse_fyers_basket_order_response(response, len(orders))

    async def modify_order(self, order_id: str, order: dict[str, Any]) -> dict[str, Any]:
        payload = {
            "id": order_id,
            "qty": order["quantity"],
            "type": self._ORDER_TYPE_CODES[order["order_type"]],
            "limitPrice": order["limit_price"],
            "stopPrice": order["stop_price"],
        }
        try:
            response = await asyncio.to_thread(self.client.modify_order, payload)
        except Exception as e:
            raise BrokerConnectionError(f"Fyers modify order request failed: {e}") from e
        response = self._require_order_success(response, "modify order")
        return {
            "id": str(response.get("id") or order_id),
            "message": str(response.get("message", "Order modified")),
        }

    async def cancel_order(self, order_id: str) -> dict[str, Any]:
        try:
            response = await asyncio.to_thread(self.client.cancel_order, {"id": order_id})
        except Exception as e:
            raise BrokerConnectionError(f"Fyers cancel order request failed: {e}") from e
        response = self._require_order_success(response, "cancel order")
        return {
            "id": str(response.get("id") or order_id),
            "message": str(response.get("message", "Order cancelled")),
        }

    async def close(self) -> None:
        if self._market_stream is not None:
            # close_connection() joins the socket's background threads —
            # blocking, so keep it off the event loop.
            await asyncio.to_thread(self._market_stream.close)
            self._market_stream = None
