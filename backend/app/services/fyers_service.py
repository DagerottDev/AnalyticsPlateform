"""Fyers broker service implementation."""

import asyncio
import time
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from fyers_apiv3 import fyersModel

from app.core.exceptions import BrokerAuthError, BrokerConnectionError
from app.core.retry import compute_backoff_delay
from app.models.user import TradingMode, UserProfile
from app.services.broker_base import BrokerService
from app.services.fyers_market_stream import FyersMarketStreamManager

# Fyers' option-chain endpoint expects exchange-qualified underlying symbols,
# not the plain index names the UI uses.
_INDEX_SYMBOL_MAP = {
    "NIFTY": "NSE:NIFTY50-INDEX",
    "NIFTY 50": "NSE:NIFTY50-INDEX",
    "NIFTY50": "NSE:NIFTY50-INDEX",
    "BANKNIFTY": "NSE:NIFTYBANK-INDEX",
    "BANK NIFTY": "NSE:NIFTYBANK-INDEX",
    "FINNIFTY": "NSE:FINNIFTY-INDEX",
    "MIDCPNIFTY": "NSE:MIDCPNIFTY-INDEX",
    "SENSEX": "BSE:SENSEX-INDEX",
    "BSE SENSEX": "BSE:SENSEX-INDEX",
}
_REVERSE_INDEX_SYMBOL_MAP = {
    "NSE:NIFTY50-INDEX": "NIFTY",
    "NSE:NIFTYBANK-INDEX": "BANKNIFTY",
    "NSE:FINNIFTY-INDEX": "FINNIFTY",
    "NSE:MIDCPNIFTY-INDEX": "MIDCPNIFTY",
    "BSE:SENSEX-INDEX": "SENSEX",
}


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
    # Request a wide chain per expiry. The UI's "All strikes" setting can
    # only display rows returned by the broker; the previous 20-strike request
    # silently made that setting look incomplete.
    _DEFAULT_STRIKE_COUNT = 50
    _INSTRUMENTS_CACHE_TTL_SECONDS = 30

    # Fyers' optionchain endpoint rate-limits aggressively (observed 429s from
    # well under 20 calls/sec). A single get_instruments fetch is itself
    # 1 + _MAX_EXPIRIES_FETCHED calls, so transient 429/5xx responses are
    # retried with backoff rather than failing the whole request.
    _MAX_FETCH_RETRIES = 3
    _RETRY_BASE_DELAY_SECONDS = 1.5
    _RETRYABLE_CODES = {429, 500, 502, 503, 504}
    # A Greek workspace may request one underlying plus ten option histories
    # at once. FYERS rate-limits the history API independently and those
    # bursts can consume capacity needed by the live quote fallback. Serialize
    # starts with a small gap for every broker session as a final safeguard,
    # even if a client bypasses the UI's limited-concurrency loader.
    _HISTORY_REQUEST_MIN_INTERVAL_SECONDS = 0.25

    # Fyers' margin calculator wants an order `type` (1=Limit, 2=Market, 3=Stop,
    # 4=StopLimit) even though no order is actually placed here — Market
    # gives a same-side-agnostic estimate without needing a limit price.
    _MARGIN_ORDER_TYPE = 2
    _ORDER_TYPE_CODES = {"LIMIT": 1, "MARKET": 2, "STOP": 3, "STOP_LIMIT": 4}
    _ORDER_TYPE_NAMES = {value: key for key, value in _ORDER_TYPE_CODES.items()}
    # Fyers' bulk-placement endpoint caps a single call at this many legs.
    _MAX_BASKET_ORDERS = 10

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
        # symbol -> lock, so concurrent requests for the same symbol (e.g.
        # /instruments and /expiries firing together on page load) coalesce
        # into a single fetch instead of each independently bursting
        # 1 + _MAX_EXPIRIES_FETCHED calls at Fyers at the same moment.
        self._instruments_locks: dict[str, asyncio.Lock] = {}
        self._history_request_lock = asyncio.Lock()
        self._next_history_request_at = 0.0
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
            raise BrokerAuthError(f"Failed to get profile: {response}")
        except Exception as e:
            raise BrokerConnectionError(f"Failed to retrieve profile: {e}") from e

    async def get_quotes(self, symbols: list[str]) -> list[dict[str, Any]]:
        """Fetch live quotes for a list of symbols from Fyers REST API."""
        if not symbols:
            return []

        # Callers pass either a bare underlying alias ("NIFTY") or an
        # already-exchange-qualified option/equity trading symbol
        # ("NSE:NIFTY26JUL23000PE") straight from the instrument list —
        # only the former needs the NSE:...-EQ mapping. Using
        # _to_fyers_symbol unconditionally here used to double-wrap the
        # latter into "NSE:NSE:...-EQ", which Fyers rejects.
        fyers_symbols = [to_fyers_ws_symbol(s) for s in symbols]
        try:
            response = await asyncio.to_thread(
                self.client.quotes, {"symbols": ",".join(fyers_symbols)}
            )
            if not response or response.get("s") != "ok":
                return []

            quotes_list: list[dict[str, Any]] = []
            for item in response.get("d", []):
                val = item.get("v", {})
                fyers_sym = item.get("n", "") or val.get("symbol", "")
                cmd = val.get("cmd", {})
                lp = cmd.get("lp") or val.get("lp") or val.get("last_price")
                if lp is None or not isinstance(lp, int | float):
                    continue

                open_price = val.get("open_price") or cmd.get("o") or cmd.get("open_price") or 0.0
                prev_close = (
                    val.get("prev_close_price")
                    or cmd.get("c")
                    or val.get("c")
                    or cmd.get("prev_close_price")
                    or open_price
                )

                ch = val.get("ch") if val.get("ch") is not None else cmd.get("ch")
                if (ch is None or ch == 0) and prev_close and prev_close > 0 and lp != prev_close:
                    ch = round(lp - prev_close, 2)
                elif ch is None:
                    ch = 0.0

                chp = val.get("chp") if val.get("chp") is not None else cmd.get("chp")
                if (chp is None or chp == 0) and prev_close and prev_close > 0 and ch != 0:
                    chp = round((ch / prev_close) * 100.0, 2)
                elif chp is None:
                    chp = 0.0

                high_price = val.get("high_price") or cmd.get("h") or cmd.get("high_price") or 0.0
                low_price = val.get("low_price") or cmd.get("l") or cmd.get("low_price") or 0.0
                ask = val.get("ask") or cmd.get("ask") or 0.0
                bid = val.get("bid") or cmd.get("bid") or 0.0
                atp = val.get("atp") or cmd.get("atp") or 0.0

                ui_symbol = from_fyers_ws_symbol(fyers_sym)
                quotes_list.append(
                    {
                        "symbol": ui_symbol,
                        "trading_symbol": ui_symbol,
                        "last_price": float(lp),
                        "volume": int(cmd.get("v") or cmd.get("volume") or val.get("volume") or 0),
                        "open_interest": 0,
                        "change": float(ch),
                        "change_percent": float(chp),
                        "open_price": float(open_price),
                        "high_price": float(high_price),
                        "low_price": float(low_price),
                        "prev_close_price": float(prev_close) if prev_close else 0.0,
                        "ask": float(ask),
                        "bid": float(bid),
                        "atp": float(atp),
                        "timestamp": int(time.time()),
                    }
                )
            return quotes_list
        except Exception as e:
            import logging
            logging.getLogger(__name__).error("Failed to fetch Fyers quotes: %s", e)
            return []

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
            delay = compute_backoff_delay(attempt, self._RETRY_BASE_DELAY_SECONDS)
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
            raise BrokerConnectionError(
                f"Failed to retrieve history for {symbol}: {last_response}"
            )
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

    @staticmethod
    def _require_order_success(response: dict[str, Any] | None, action: str) -> dict[str, Any]:
        if not response or response.get("s") != "ok":
            raise BrokerConnectionError(f"Fyers {action} request failed: {response}")
        return response

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
                    "limit_price": float(row.get("limitPrice", 0) or 0),
                    "stop_price": float(row.get("stopPrice", 0) or 0),
                    "status": status,
                    "status_message": row.get("statusMessage") or row.get("message"),
                    "order_time": row.get("orderDateTime") or row.get("orderTime"),
                }
            )
        return [order for order in orders if order["id"]]

    def _order_payload(self, order: dict[str, Any]) -> dict[str, Any]:
        """Shared per-order payload shaping for both single and basket placement."""
        payload = {
            "symbol": order["symbol"],
            "qty": order["quantity"],
            "type": self._ORDER_TYPE_CODES[order["order_type"]],
            "side": 1 if order["side"] == "Buy" else -1,
            "productType": order["product_type"],
            "limitPrice": order["limit_price"],
            "stopPrice": order["stop_price"],
            "validity": order["validity"],
            "disclosedQty": order["disclosed_quantity"],
            "offlineOrder": order["offline_order"],
            "stopLoss": order["stop_loss"],
            "takeProfit": order["take_profit"],
        }
        if order.get("order_tag"):
            payload["orderTag"] = order["order_tag"]
        return payload

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
    # order in the same order they were submitted. The exact success/failure
    # shape of each element isn't documented beyond "the response of all the
    # orders will be provided... in the same order", so parsing here is
    # deliberately tolerant: it never reports a leg as succeeded unless it
    # can find an explicit id/ok status for it, and falls back to an
    # explicit failure message rather than guessing when the shape doesn't
    # match what was expected.
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

        rows: list[Any] | None = None
        if isinstance(response, list):
            rows = response
        elif isinstance(response, dict):
            for key in ("data", "orders", "d"):
                candidate = response.get(key)
                if isinstance(candidate, list):
                    rows = candidate
                    break
        if rows is None or len(rows) != len(orders):
            raise BrokerConnectionError(
                f"Fyers basket order response did not match the submitted legs: {response}"
            )

        results: list[dict[str, Any]] = []
        for row in rows:
            row_data = row.get("body", row) if isinstance(row, dict) else {}
            order_id = row_data.get("id") if isinstance(row_data, dict) else None
            succeeded = isinstance(row, dict) and (
                row.get("s") == "ok" or row.get("code") == 1100 or order_id is not None
            )
            results.append(
                {
                    "id": order_id if succeeded else None,
                    "message": str(
                        row_data.get("message", "Order submitted" if succeeded else "Leg failed")
                        if isinstance(row_data, dict)
                        else "Leg failed"
                    ),
                }
            )
        return results

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
