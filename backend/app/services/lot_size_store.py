"""Live F&O lot sizes, sourced from Fyers' public symbol master files.

Lot sizes used to be a hardcoded symbol -> int table, but NSE/BSE revise
them periodically (most recently the January 2026 index derivatives
revision) and a hardcoded table just goes stale until a broker call gets
rejected for a bad quantity multiple. These files are the exchange-derived
master Fyers itself trades off of, so they stay current without a code
change.
"""

import csv
import io
import logging
import time
from asyncio import Lock

import httpx

logger = logging.getLogger(__name__)

_SYMBOL_MASTER_URLS = (
    "https://public.fyers.in/sym_details/NSE_FO.csv",
    "https://public.fyers.in/sym_details/BSE_FO.csv",
)

# Column layout of Fyers' symbol master CSV (undocumented, reverse-engineered
# from the live file): column 13 is the underlying's plain symbol name (e.g.
# "NIFTY", "RELIANCE"), column 3 is that contract's lot size. Every row for a
# given underlying carries the same lot size, so the last row parsed wins.
_UNDERLYING_SYMBOL_COLUMN = 13
_LOT_SIZE_COLUMN = 3


class LotSizeStore:
    """Process-local cache of underlying -> lot size.

    Refreshed periodically from Fyers' public symbol master. If a refresh
    fails, the last known-good snapshot keeps serving rather than lookups
    failing outright.
    """

    _CACHE_TTL_SECONDS = 6 * 60 * 60  # lot sizes change on exchange circulars, not intraday

    def __init__(self, http_client: httpx.AsyncClient | None = None) -> None:
        # Tests inject a client wired to an httpx.MockTransport; production
        # code leaves this None and gets a short-lived real client per refresh.
        self._client = http_client
        self._lot_sizes: dict[str, int] = {}
        self._fetched_at: float = 0.0
        self._lock = Lock()

    async def get(self, symbol: str) -> int | None:
        if not self._is_fresh():
            async with self._lock:
                if not self._is_fresh():
                    await self._refresh()
        return self._lot_sizes.get(symbol.upper())

    def _is_fresh(self) -> bool:
        return bool(self._lot_sizes) and (
            time.monotonic() - self._fetched_at
        ) < self._CACHE_TTL_SECONDS

    async def _refresh(self) -> None:
        merged: dict[str, int] = {}
        if self._client is not None:
            merged = await self._fetch_all(self._client)
        else:
            async with httpx.AsyncClient(timeout=15.0) as client:
                merged = await self._fetch_all(client)

        if merged:
            self._lot_sizes = merged
            self._fetched_at = time.monotonic()
        elif not self._lot_sizes:
            logger.error(
                "Failed to fetch lot size master data from Fyers; lot size "
                "lookups will return None until the next refresh"
            )

    @staticmethod
    async def _fetch_all(client: httpx.AsyncClient) -> dict[str, int]:
        merged: dict[str, int] = {}
        for url in _SYMBOL_MASTER_URLS:
            try:
                response = await client.get(url)
                response.raise_for_status()
            except httpx.HTTPError as e:
                logger.warning("Failed to fetch lot size master %s: %s", url, e)
                continue
            merged.update(LotSizeStore._parse(response.text))
        return merged

    @staticmethod
    def _parse(csv_text: str) -> dict[str, int]:
        lot_sizes: dict[str, int] = {}
        for row in csv.reader(io.StringIO(csv_text)):
            if len(row) <= max(_UNDERLYING_SYMBOL_COLUMN, _LOT_SIZE_COLUMN):
                continue
            symbol = row[_UNDERLYING_SYMBOL_COLUMN].strip().upper()
            try:
                lot_size = int(float(row[_LOT_SIZE_COLUMN]))
            except ValueError:
                continue
            if symbol and lot_size > 0:
                lot_sizes[symbol] = lot_size
        return lot_sizes


lot_size_store = LotSizeStore()
