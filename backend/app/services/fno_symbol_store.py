"""Current NSE F&O underlyings from Fyers' public symbol master.

The exchange derivative universe changes during scheduled reviews and symbol
renames. Keeping the IV screener on a permanent hand-maintained list makes
cash-only or retired symbols appear with empty spot/IV cells. Fyers already
publishes the contract master used by its own APIs, so use its current option
underlyings and retain the checked-in list only as a safe fallback.
"""

import csv
import io
import logging
import time
from asyncio import Lock
from collections.abc import Mapping

import httpx

logger = logging.getLogger(__name__)

_NSE_FO_SYMBOL_MASTER_URL = "https://public.fyers.in/sym_details/NSE_FO.csv"
_CACHE_TTL_SECONDS = 6 * 60 * 60
_UNDERLYING_SYMBOL_COLUMN = 13
_OPTION_TYPE_COLUMN = 16
_OPTION_TYPES = {"CE", "PE"}
_INDEX_UNDERLYINGS = frozenset(
    {"NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50"}
)


class FnoSymbolStore:
    """Process-local cache of current NSE stock-option underlyings."""

    def __init__(self, http_client: httpx.AsyncClient | None = None) -> None:
        # Tests inject a MockTransport client. Production creates a short-lived
        # client for each refresh so this store owns no long-lived connection.
        self._client = http_client
        self._symbols: dict[str, str] = {}
        self._fetched_at = 0.0
        self._lock = Lock()

    async def get(self, fallback: Mapping[str, str]) -> dict[str, str]:
        """Return current stock-option underlyings, with a safe fallback.

        The fallback is used when the public master is temporarily unavailable
        or when the broker is not Fyers. A previously fetched master remains
        usable through a later refresh failure.
        """
        if not self._is_fresh():
            async with self._lock:
                if not self._is_fresh():
                    await self._refresh()

        source = self._symbols or _normalize_mapping(fallback)
        return _ordered_with_display_names(source, fallback)

    def _is_fresh(self) -> bool:
        return bool(self._symbols) and time.monotonic() - self._fetched_at < _CACHE_TTL_SECONDS

    async def _refresh(self) -> None:
        try:
            if self._client is not None:
                symbols = await self._fetch(self._client)
            else:
                async with httpx.AsyncClient(timeout=20.0) as client:
                    symbols = await self._fetch(client)
        except httpx.HTTPError as exc:
            logger.warning("Failed to fetch current Fyers NSE F&O symbol master: %s", exc)
            return

        if symbols:
            self._symbols = symbols
            self._fetched_at = time.monotonic()
        elif not self._symbols:
            logger.warning("Fyers NSE F&O symbol master contained no option underlyings")

    @staticmethod
    async def _fetch(client: httpx.AsyncClient) -> dict[str, str]:
        response = await client.get(_NSE_FO_SYMBOL_MASTER_URL)
        response.raise_for_status()
        return FnoSymbolStore._parse(response.text)

    @staticmethod
    def _parse(csv_text: str) -> dict[str, str]:
        """Extract stock underlyings that have at least one CE/PE contract."""
        symbols: dict[str, str] = {}
        for row in csv.reader(io.StringIO(csv_text)):
            if len(row) <= max(_UNDERLYING_SYMBOL_COLUMN, _OPTION_TYPE_COLUMN):
                continue
            if row[_OPTION_TYPE_COLUMN].strip().upper() not in _OPTION_TYPES:
                continue
            symbol = row[_UNDERLYING_SYMBOL_COLUMN].strip().upper()
            if not symbol or symbol in _INDEX_UNDERLYINGS:
                continue
            # The master carries the exact exchange-facing underlying. The
            # display name is filled from the curated fallback when available.
            symbols.setdefault(symbol, symbol)
        return symbols


def _normalize_mapping(mapping: Mapping[str, str]) -> dict[str, str]:
    return {str(symbol).upper(): str(name) for symbol, name in mapping.items()}


def _ordered_with_display_names(
    source: Mapping[str, str], fallback: Mapping[str, str]
) -> dict[str, str]:
    """Keep the curated order, then append newly listed live symbols."""
    normalized_source = {str(symbol).upper(): str(name) for symbol, name in source.items()}
    normalized_fallback = _normalize_mapping(fallback)
    ordered_symbols = [
        symbol for symbol in normalized_fallback if symbol in normalized_source
    ]
    ordered_symbols.extend(
        sorted(symbol for symbol in normalized_source if symbol not in normalized_fallback)
    )
    return {
        symbol: normalized_fallback.get(symbol, normalized_source[symbol])
        for symbol in ordered_symbols
    }


fno_symbol_store = FnoSymbolStore()
