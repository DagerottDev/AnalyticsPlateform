import asyncio
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models.open_interest_snapshot import OpenInterestSnapshot
from app.services import open_interest_snapshots as oi_module
from app.services.open_interest_snapshots import (
    aggregate_instruments,
    capture_expiry,
    capture_scheduled_snapshots,
    is_regular_market_open,
    load_history,
    nearest_expiry,
    purge_expired,
    store_snapshot,
)
from app.services.session_manager import session_manager


def _instruments() -> list[dict[str, object]]:
    return [
        {"expiry": "28-Aug-2026", "option_type": "CE", "oi": 100, "oi_change": 20},
        {"expiry": "28-Aug-2026", "option_type": "PE", "oi": 180, "oi_change": -10},
        {"expiry": "28-Aug-2026", "option_type": "CE", "oi": 50, "oi_change": -5},
        {"expiry": "04-Sep-2026", "option_type": "CE", "oi": 999, "oi_change": 99},
    ]


def test_aggregate_expiry_oi_keeps_positive_and_negative_session_changes() -> None:
    assert aggregate_instruments(_instruments(), "28-Aug-2026") == (150.0, 180.0, 15.0, -10.0)
    assert aggregate_instruments(_instruments(), "missing") is None


def test_aggregate_ignores_instruments_with_a_non_finite_or_missing_oi() -> None:
    instruments = [
        {"expiry": "28-Aug-2026", "option_type": "CE", "oi": float("nan"), "oi_change": 1},
        {"expiry": "28-Aug-2026", "option_type": "CE", "oi": float("inf"), "oi_change": 1},
        {"expiry": "28-Aug-2026", "option_type": "PE", "oi": None, "oi_change": 1},
        {"expiry": "28-Aug-2026", "option_type": "CE", "oi": True, "oi_change": 1},  # bool, not int
        {"expiry": "28-Aug-2026", "option_type": "CE", "oi": 40, "oi_change": None},
    ]

    result = aggregate_instruments(instruments, "28-Aug-2026")

    assert result == (40.0, 0.0, 0.0, 0.0)  # only the last CE row counted; missing change -> 0


def test_nearest_expiry_picks_the_soonest_by_calendar_order_not_string_order() -> None:
    instruments = [
        {"expiry": "04-Sep-2026", "option_type": "CE"},
        {"expiry": "28-Aug-2026", "option_type": "PE"},
        {"expiry": "11-Sep-2026", "option_type": "CE"},
    ]

    assert nearest_expiry(instruments) == "28-Aug-2026"


def test_nearest_expiry_returns_none_when_no_instrument_has_a_ce_or_pe_expiry() -> None:
    assert nearest_expiry([{"expiry": None, "option_type": "CE"}]) is None
    assert nearest_expiry([{"expiry": "28-Aug-2026", "option_type": "FUT"}]) is None
    assert nearest_expiry([]) is None


def test_market_hours_only_allow_nse_regular_weekdays() -> None:
    assert is_regular_market_open(datetime(2026, 8, 3, 4, 45, tzinfo=UTC))  # 10:15 IST Monday
    assert not is_regular_market_open(datetime(2026, 8, 2, 4, 45, tzinfo=UTC))  # Sunday
    assert not is_regular_market_open(datetime(2026, 8, 3, 3, 30, tzinfo=UTC))  # pre-open
    assert is_regular_market_open(datetime(2026, 8, 3, 10, 5, tzinfo=UTC))  # 15:35 IST
    assert not is_regular_market_open(datetime(2026, 8, 3, 10, 10, tzinfo=UTC))  # 15:40 IST


@pytest.mark.asyncio
async def test_snapshot_bucket_deduplicates_and_history_is_owner_scoped(
    db_session: AsyncSession,
) -> None:
    observed = datetime(2026, 8, 3, 4, 45, 12, tzinfo=UTC)
    await store_snapshot(
        db_session,
        owner_id="owner-a",
        symbol="NIFTY",
        expiry="28-Aug-2026",
        observed_at=observed,
        interval_seconds=30,
        values=(100, 200, 10, -5),
    )
    await store_snapshot(
        db_session,
        owner_id="owner-a",
        symbol="NIFTY",
        expiry="28-Aug-2026",
        observed_at=observed + timedelta(seconds=9),
        interval_seconds=30,
        values=(120, 210, 12, -4),
    )
    await store_snapshot(
        db_session,
        owner_id="owner-b",
        symbol="NIFTY",
        expiry="28-Aug-2026",
        observed_at=observed,
        interval_seconds=30,
        values=(900, 900, 0, 0),
    )

    session_date, history = await load_history(
        db_session,
        owner_id="owner-a",
        symbol="NIFTY",
        expiry="28-Aug-2026",
    )

    assert session_date is not None
    assert len(history) == 1
    assert history[0].total_call_oi == 120
    count = (
        await db_session.execute(select(func.count()).select_from(OpenInterestSnapshot))
    ).scalar_one()
    assert count == 2


@pytest.mark.asyncio
async def test_capture_and_retention_purge(db_session: AsyncSession) -> None:
    service = AsyncMock()
    service.get_instruments.return_value = _instruments()
    old = datetime(2026, 6, 1, 4, 45, tzinfo=UTC)
    await capture_expiry(
        db_session,
        service,
        owner_id="owner-a",
        symbol="NIFTY",
        expiry="28-Aug-2026",
        interval_seconds=30,
        observed_at=old,
    )
    await purge_expired(
        db_session,
        now=datetime(2026, 8, 3, 4, 45, tzinfo=UTC),
        trading_days=30,
    )
    _, history = await load_history(
        db_session,
        owner_id="owner-a",
        symbol="NIFTY",
        expiry="28-Aug-2026",
    )
    assert history == []


@pytest.mark.asyncio
async def test_capture_expiry_returns_none_when_no_usable_oi_is_found(
    db_session: AsyncSession,
) -> None:
    service = AsyncMock()
    service.get_instruments.return_value = _instruments()

    result = await capture_expiry(
        db_session,
        service,
        owner_id="owner-a",
        symbol="NIFTY",
        expiry="expiry-with-no-matching-rows",
        interval_seconds=30,
    )

    assert result is None


class _FakeSessionContext:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def __aenter__(self) -> AsyncSession:
        return self._session

    async def __aexit__(self, *_exc_info: object) -> None:
        return None


@pytest.fixture(autouse=True)
async def _clear_broker_session() -> None:
    yield
    await session_manager.clear()


@pytest.mark.asyncio
async def test_capture_scheduled_snapshots_is_a_noop_outside_market_hours(
    test_settings: Settings,
) -> None:
    sunday = datetime(2026, 8, 2, 4, 45, tzinfo=UTC)

    captured = await capture_scheduled_snapshots(test_settings, now=sunday)

    assert captured == 0


@pytest.mark.asyncio
async def test_capture_scheduled_snapshots_is_a_noop_without_an_active_broker_session(
    test_settings: Settings,
) -> None:
    market_open = datetime(2026, 8, 3, 4, 45, tzinfo=UTC)  # 10:15 IST Monday

    captured = await capture_scheduled_snapshots(test_settings, now=market_open)

    assert captured == 0


@pytest.mark.asyncio
async def test_capture_scheduled_snapshots_captures_every_configured_symbol_and_purges(
    db_session: AsyncSession, test_settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        oi_module, "async_session_maker", lambda: _FakeSessionContext(db_session)
    )
    settings = test_settings.model_copy(
        update={"market_data_backfill_symbols": "NIFTY,BANKNIFTY"}
    )
    service = AsyncMock()
    service.get_instruments.return_value = _instruments()
    await session_manager.set_session("TEST_CLIENT_001", service)
    market_open = datetime(2026, 8, 3, 4, 45, tzinfo=UTC)  # 10:15 IST Monday

    captured = await capture_scheduled_snapshots(settings, now=market_open)

    assert captured == 2
    assert service.get_instruments.await_count == 2


@pytest.mark.asyncio
async def test_capture_scheduled_snapshots_one_symbol_failing_does_not_block_the_rest(
    db_session: AsyncSession, test_settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        oi_module, "async_session_maker", lambda: _FakeSessionContext(db_session)
    )
    settings = test_settings.model_copy(
        update={"market_data_backfill_symbols": "BROKEN,NIFTY"}
    )
    service = AsyncMock()
    calls = 0

    async def flaky_get_instruments(_symbol: str) -> list[dict]:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("Fyers option chain request failed")
        return _instruments()

    service.get_instruments.side_effect = flaky_get_instruments
    await session_manager.set_session("TEST_CLIENT_001", service)
    market_open = datetime(2026, 8, 3, 4, 45, tzinfo=UTC)

    captured = await capture_scheduled_snapshots(settings, now=market_open)

    assert captured == 1  # BROKEN skipped, NIFTY still captured
    assert calls == 2


@pytest.mark.asyncio
async def test_capture_scheduled_snapshots_skips_a_symbol_with_no_matching_expiry(
    db_session: AsyncSession, test_settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        oi_module, "async_session_maker", lambda: _FakeSessionContext(db_session)
    )
    settings = test_settings.model_copy(update={"market_data_backfill_symbols": "NIFTY"})
    service = AsyncMock()
    service.get_instruments.return_value = [{"expiry": None, "option_type": "FUT"}]  # no CE/PE
    await session_manager.set_session("TEST_CLIENT_001", service)
    market_open = datetime(2026, 8, 3, 4, 45, tzinfo=UTC)

    captured = await capture_scheduled_snapshots(settings, now=market_open)

    assert captured == 0


@pytest.mark.asyncio
async def test_loop_runs_immediately_then_stops_on_the_stop_event(
    test_settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = 0

    async def fake_capture(_settings: Settings) -> int:
        nonlocal calls
        calls += 1
        stop_event.set()
        return 0

    monkeypatch.setattr(oi_module, "capture_scheduled_snapshots", fake_capture)
    stop_event = asyncio.Event()

    await oi_module.open_interest_snapshot_loop(test_settings, stop_event)

    assert calls == 1


@pytest.mark.asyncio
async def test_loop_survives_a_cycle_that_raises_outside_the_per_symbol_guard(
    test_settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Regression test for the bug found while writing these tests:
    capture_scheduled_snapshots only guards its per-symbol body — a failure
    in the setup around it (async_session_maker, purge_expired) used to
    propagate out of open_interest_snapshot_loop's while loop and
    permanently end open-interest snapshotting for the rest of the
    process's life."""
    settings = test_settings.model_copy(
        update={"open_interest_snapshot_interval_seconds": 0.01}
    )
    attempts = 0

    async def flaky_capture(_settings: Settings) -> int:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("async_session_maker() failed: pool exhausted")
        stop_event.set()
        return 0

    monkeypatch.setattr(oi_module, "capture_scheduled_snapshots", flaky_capture)
    stop_event = asyncio.Event()

    await oi_module.open_interest_snapshot_loop(settings, stop_event)  # must not raise

    assert attempts == 2
