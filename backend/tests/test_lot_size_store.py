"""Tests for the dynamic (broker symbol-master-backed) lot size lookup."""

import httpx
import pytest

from app.services.lot_size_store import LotSizeStore

_NSE_FO_CSV = (
    "101126082558067,BANKNIFTY 25 Aug 26 FUT,11,30,0.2,,x,2026-07-30,1787652000,"
    "NSE:BANKNIFTY26AUGFUT,10,11,58067,BANKNIFTY,26009,-1.0,XX,101000000026009,None,0,0.0\n"
    "101126082535462,NIFTY 25 Aug 26 18300 CE,14,65,0.05,,x,2026-07-30,1787652000,"
    "NSE:NIFTY26AUG18300CE,10,11,35462,NIFTY,26000,18300.0,CE,101000000026000,None,0,0.0\n"
)
_BSE_FO_CSV = (
    "1211260827825622,SENSEX 27 Aug 26 FUT ,11,20,0.05,,x,2026-07-30,1787824800,"
    "BSE:SENSEX26AUGFUT,12,11,825622,SENSEX,1,-1.0,,12100000001,None,0,0.0\n"
)


def _store_with_transport(handler) -> LotSizeStore:
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return LotSizeStore(http_client=client)


@pytest.mark.asyncio
async def test_get_parses_lot_size_from_symbol_master() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        body = _NSE_FO_CSV if "NSE_FO" in str(request.url) else _BSE_FO_CSV
        return httpx.Response(200, text=body)

    store = _store_with_transport(handler)

    assert await store.get("NIFTY") == 65
    assert await store.get("banknifty") == 30  # case-insensitive
    assert await store.get("SENSEX") == 20


@pytest.mark.asyncio
async def test_get_returns_none_for_unknown_symbol() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        body = _NSE_FO_CSV if "NSE_FO" in str(request.url) else _BSE_FO_CSV
        return httpx.Response(200, text=body)

    store = _store_with_transport(handler)

    assert await store.get("NOTAREALSYMBOL") is None


@pytest.mark.asyncio
async def test_refresh_failure_falls_back_to_last_known_snapshot() -> None:
    call_count = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        if call_count <= 2:
            body = _NSE_FO_CSV if "NSE_FO" in str(request.url) else _BSE_FO_CSV
            return httpx.Response(200, text=body)
        return httpx.Response(503)

    store = _store_with_transport(handler)
    assert await store.get("NIFTY") == 65

    # Force a refresh even though the cache is fresh, to simulate the master
    # going unavailable later — the stale-but-known value should still serve.
    store._fetched_at = 0.0
    assert await store.get("NIFTY") == 65


@pytest.mark.asyncio
async def test_get_returns_none_when_master_never_fetched_successfully() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    store = _store_with_transport(handler)

    assert await store.get("NIFTY") is None
