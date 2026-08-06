"""Tests for durable, idempotent daily-candle backfills."""

import asyncio
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.core.exceptions import BrokerAuthError
from app.models.market_data import MarketData
from app.services import market_data_backfill
from app.services.market_data_backfill import backfill_symbol
from app.services.session_manager import session_manager


def _candles() -> list[dict]:
    start = datetime(2026, 7, 27, tzinfo=UTC)
    return [
        {
            "timestamp": start + timedelta(days=index),
            "open": 22000.0 + index,
            "high": 22100.0 + index,
            "low": 21900.0 + index,
            "close": 22050.0 + index,
            "volume": 1000 + index,
            "open_interest": 0,
        }
        for index in range(2)
    ]


@pytest.mark.asyncio
async def test_backfill_persists_and_upserts_overlapping_daily_candles(
    db_session: AsyncSession,
) -> None:
    service = AsyncMock()
    first_batch = _candles()
    service.get_historical_data.return_value = first_batch

    first = await backfill_symbol(
        db_session,
        service,
        symbol="nifty",
        initial_lookback_days=365,
        overlap_days=7,
    )

    corrected_batch = _candles()
    corrected_batch[-1] = {**corrected_batch[-1], "close": 22222.0}
    service.get_historical_data.return_value = corrected_batch
    second = await backfill_symbol(
        db_session,
        service,
        symbol="NIFTY",
        initial_lookback_days=365,
        overlap_days=7,
    )

    count = await db_session.scalar(select(func.count()).select_from(MarketData))
    latest = await db_session.get(
        MarketData, (corrected_batch[-1]["timestamp"], "NIFTY")
    )
    assert first.fetched == 2
    assert second.persisted == 2
    assert count == 2
    assert latest is not None
    assert latest.close == 22222.0
    assert service.get_historical_data.await_count == 2


class _FakeSessionContext:
    """Hands back the shared test db_session instead of opening a new engine
    connection, since run_market_data_backfill opens its own sessions via
    async_session_maker() rather than taking one as an argument."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def __aenter__(self) -> AsyncSession:
        return self._session

    async def __aexit__(self, *exc_info: object) -> None:
        return None


@pytest.fixture(autouse=True)
async def _clear_broker_session() -> None:
    yield
    await session_manager.clear()


@pytest.mark.asyncio
async def test_run_backfill_skips_entirely_without_an_active_broker_session(
    test_settings: Settings,
) -> None:
    results = await market_data_backfill.run_market_data_backfill(test_settings)

    assert results == []


@pytest.mark.asyncio
async def test_run_backfill_persists_every_configured_symbol(
    db_session: AsyncSession, test_settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        market_data_backfill, "async_session_maker", lambda: _FakeSessionContext(db_session)
    )
    settings = test_settings.model_copy(
        update={"market_data_backfill_symbols": "NIFTY,BANKNIFTY"}
    )
    service = AsyncMock()
    service.get_historical_data.return_value = _candles()
    await session_manager.set_session("TEST_CLIENT_001", service)

    results = await market_data_backfill.run_market_data_backfill(settings)

    assert [r.symbol for r in results] == ["NIFTY", "BANKNIFTY"]
    assert all(r.persisted == 2 for r in results)


@pytest.mark.asyncio
async def test_run_backfill_one_symbol_failing_does_not_block_the_rest(
    db_session: AsyncSession, test_settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        market_data_backfill, "async_session_maker", lambda: _FakeSessionContext(db_session)
    )
    settings = test_settings.model_copy(
        update={"market_data_backfill_symbols": "BROKEN,NIFTY"}
    )
    service = AsyncMock()
    calls = 0

    async def flaky_fetch(_symbol: str, *_a: object) -> list[dict]:
        # "BROKEN" is backfilled first (settings order); fail only that call.
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("Fyers historical-data request failed")
        return _candles()

    service.get_historical_data.side_effect = flaky_fetch
    await session_manager.set_session("TEST_CLIENT_001", service)

    results = await market_data_backfill.run_market_data_backfill(settings)

    assert [r.symbol for r in results] == ["NIFTY"]  # BROKEN skipped, NIFTY still persisted


@pytest.mark.asyncio
async def test_run_backfill_stops_and_invalidates_the_session_on_an_auth_error(
    db_session: AsyncSession, test_settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        market_data_backfill, "async_session_maker", lambda: _FakeSessionContext(db_session)
    )
    settings = test_settings.model_copy(
        update={"market_data_backfill_symbols": "NIFTY,BANKNIFTY"}
    )
    service = AsyncMock()
    service.get_historical_data.side_effect = BrokerAuthError("Fyers token expired")
    await session_manager.set_session("TEST_CLIENT_001", service)
    invalidate = AsyncMock()
    monkeypatch.setattr(market_data_backfill, "invalidate_broker_session", invalidate)

    results = await market_data_backfill.run_market_data_backfill(settings)

    assert results == []
    invalidate.assert_awaited_once()
    # Stops at the first auth failure rather than retrying it per remaining symbol.
    assert service.get_historical_data.await_count == 1


@pytest.mark.asyncio
async def test_request_market_data_backfill_wakes_the_loop_immediately(
    test_settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """request_market_data_backfill lets a fresh broker login skip waiting
    out the full poll interval before the first backfill runs."""
    settings = test_settings.model_copy(
        update={"market_data_backfill_interval_seconds": 3600.0}
    )
    calls = 0

    async def fake_run(_settings: Settings) -> list:
        nonlocal calls
        calls += 1
        if calls == 2:
            stop_event.set()
        return []

    monkeypatch.setattr(market_data_backfill, "run_market_data_backfill", fake_run)
    # _backfill_requested is a real module-level singleton Event, shared
    # across the whole process. Each test may run in its own event loop
    # under pytest-asyncio, and an asyncio.Event binds internally to
    # whichever loop first calls .wait() on it — reusing the real global
    # across test-loop boundaries leaks an orphaned task into a later
    # test's loop. Swap in a fresh Event scoped to just this test.
    monkeypatch.setattr(market_data_backfill, "_backfill_requested", asyncio.Event())
    stop_event = asyncio.Event()
    loop_task = asyncio.create_task(
        market_data_backfill.market_data_backfill_loop(settings, stop_event)
    )

    for _ in range(200):
        if calls >= 1:
            break
        await asyncio.sleep(0.01)
    assert calls == 1  # ran immediately at startup, now waiting out the long interval

    market_data_backfill.request_market_data_backfill()
    await asyncio.wait_for(loop_task, timeout=5)

    assert calls == 2  # woke immediately rather than waiting the full hour


@pytest.mark.asyncio
async def test_loop_survives_a_cycle_that_raises_outside_the_per_symbol_guard(
    test_settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Regression test for the bug found while writing these tests:
    run_market_data_backfill only guards its per-symbol body — a failure in
    the setup around it (session_manager, async_session_maker) used to
    propagate out of market_data_backfill_loop's while loop and permanently
    end market-data backfill for the rest of the process's life."""
    settings = test_settings.model_copy(
        update={"market_data_backfill_interval_seconds": 0.01}
    )
    attempts = 0

    async def flaky_run(_settings: Settings) -> list:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("async_session_maker() failed: pool exhausted")
        stop_event.set()
        return []

    monkeypatch.setattr(market_data_backfill, "run_market_data_backfill", flaky_run)
    stop_event = asyncio.Event()

    await market_data_backfill.market_data_backfill_loop(settings, stop_event)  # must not raise

    assert attempts == 2
