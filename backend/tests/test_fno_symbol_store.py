"""Tests for the live Fyers NSE F&O underlying master cache."""

import httpx
import pytest

from app.services.fno_symbol_store import FnoSymbolStore

_NSE_FO_CSV = (
    "101,RELIANCE 25 Aug 26 FUT,11,500,0.05,,x,2026-08-03,1787652600,"
    "NSE:RELIANCE26AUGFUT,10,11,1,RELIANCE,2885,-1.0,XX,0,None,0,0\n"
    "102,RELIANCE 25 Aug 26 1200 CE,14,500,0.05,,x,2026-08-03,1787652600,"
    "NSE:RELIANCE26AUG1200CE,10,11,2,RELIANCE,2885,1200.0,CE,0,None,0,0\n"
    "103,BANKNIFTY 25 Aug 26 50000 CE,14,30,0.05,,x,2026-08-03,1787652600,"
    "NSE:BANKNIFTY26AUG50000CE,10,11,3,BANKNIFTY,26009,50000.0,CE,0,None,0,0\n"
    "104,TMPV 25 Aug 26 350 CE,14,1000,0.05,,x,2026-08-03,1787652600,"
    "NSE:TMPV26AUG350CE,10,11,4,TMPV,26010,350.0,CE,0,None,0,0\n"
)


def _store_with_transport(handler) -> FnoSymbolStore:
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return FnoSymbolStore(http_client=client)


@pytest.mark.asyncio
async def test_get_returns_only_current_stock_option_underlyings() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=_NSE_FO_CSV)

    store = _store_with_transport(handler)

    symbols = await store.get(
        {
            "RELIANCE": "Reliance Industries",
            "STALE": "Stale Company",
        }
    )

    assert symbols == {
        "RELIANCE": "Reliance Industries",
        "TMPV": "TMPV",
    }


@pytest.mark.asyncio
async def test_refresh_failure_uses_the_checked_in_fallback() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    store = _store_with_transport(handler)
    fallback = {"RELIANCE": "Reliance Industries", "STALE": "Stale Company"}

    assert await store.get(fallback) == fallback
