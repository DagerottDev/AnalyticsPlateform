"""Tests for the scheduled F&O IV universe backfill job."""

import asyncio
from datetime import UTC, date, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.core.exceptions import BrokerAuthError
from app.services import iv_universe_backfill
from app.services.fo_iv_universe_store import (
    load_latest_snapshot_per_symbol,
    load_symbol_history,
    upsert_snapshot,
)
from app.services.iv_history_seed import HistoricalIvObservation
from app.services.iv_stats import MIN_IV_HISTORY_OBSERVATIONS


@pytest.fixture(autouse=True)
def _reset_seed_attempted_cache():
    """_history_seed_attempted is process-global, module-level state — reset
    it around every test in this file so one test's seeding attempt can't
    silently suppress another's (order-dependent flakiness)."""
    iv_universe_backfill._history_seed_attempted.clear()
    yield
    iv_universe_backfill._history_seed_attempted.clear()


@pytest.fixture
def fast_settings(test_settings: Settings) -> Settings:
    """Zero the inter-symbol delay so tests don't pay real sleep time."""
    return test_settings.model_copy(update={"iv_universe_backfill_symbol_delay_seconds": 0.0})


@pytest.mark.asyncio
async def test_skips_entirely_without_an_active_broker_session(
    db_session: AsyncSession, fast_settings: Settings, monkeypatch
):
    monkeypatch.setattr(iv_universe_backfill, "NSE_FO_SYMBOLS", {"RELIANCE": "Reliance"})
    compute_atm_iv = AsyncMock()
    monkeypatch.setattr(iv_universe_backfill, "compute_atm_iv", compute_atm_iv)
    monkeypatch.setattr(
        iv_universe_backfill, "async_session_maker", lambda: _FakeSessionContext(db_session)
    )

    await iv_universe_backfill.run_iv_universe_backfill(fast_settings)

    compute_atm_iv.assert_not_awaited()


@pytest.mark.asyncio
async def test_skips_symbols_already_captured_today_and_persists_the_rest(
    db_session: AsyncSession,
    fast_settings: Settings,
    active_broker_session: AsyncMock,
    monkeypatch,
):
    monkeypatch.setattr(
        iv_universe_backfill, "NSE_FO_SYMBOLS", {"RELIANCE": "Reliance", "TCS": "TCS"}
    )
    today = datetime.now(UTC).date()
    await upsert_snapshot(
        db_session,
        symbol="RELIANCE",
        snapshot_date=today,
        atm_iv=0.18,
        spot=2900.0,
        iv_rank=None,
        iv_percentile=None,
    )
    compute_atm_iv = AsyncMock(return_value=(0.25, 3800.0))
    monkeypatch.setattr(iv_universe_backfill, "compute_atm_iv", compute_atm_iv)
    monkeypatch.setattr(
        iv_universe_backfill, "async_session_maker", lambda: _FakeSessionContext(db_session)
    )

    await iv_universe_backfill.run_iv_universe_backfill(fast_settings)

    compute_atm_iv.assert_awaited_once_with(active_broker_session, "TCS")
    latest = {
        snapshot.symbol: snapshot
        for snapshot in await load_latest_snapshot_per_symbol(db_session)
    }
    assert latest["RELIANCE"].atm_iv == 0.18  # untouched — already captured today
    assert latest["TCS"].atm_iv == 0.25
    assert latest["TCS"].spot == 3800.0


@pytest.mark.asyncio
async def test_refreshes_a_stale_current_day_snapshot(
    db_session: AsyncSession,
    fast_settings: Settings,
    active_broker_session: AsyncMock,
    monkeypatch,
):
    monkeypatch.setattr(iv_universe_backfill, "NSE_FO_SYMBOLS", {"RELIANCE": "Reliance"})
    snapshot_date = datetime.now(UTC).date()
    snapshot = await upsert_snapshot(
        db_session,
        symbol="RELIANCE",
        snapshot_date=snapshot_date,
        atm_iv=0.18,
        spot=2900.0,
        iv_rank=None,
        iv_percentile=None,
    )
    snapshot.updated_at = datetime.now(UTC) - timedelta(hours=2)
    await db_session.commit()
    monkeypatch.setattr(
        iv_universe_backfill,
        "compute_atm_iv",
        AsyncMock(return_value=(0.22, 3000.0)),
    )
    monkeypatch.setattr(
        iv_universe_backfill, "async_session_maker", lambda: _FakeSessionContext(db_session)
    )

    await iv_universe_backfill.run_iv_universe_backfill(fast_settings)

    latest = {
        item.symbol: item for item in await load_latest_snapshot_per_symbol(db_session)
    }
    assert latest["RELIANCE"].atm_iv == 0.22
    assert latest["RELIANCE"].spot == 3000.0


@pytest.mark.asyncio
async def test_one_failing_symbol_does_not_block_the_rest(
    db_session: AsyncSession,
    fast_settings: Settings,
    active_broker_session: AsyncMock,
    monkeypatch,
):
    monkeypatch.setattr(
        iv_universe_backfill, "NSE_FO_SYMBOLS", {"BROKEN": "Broken Corp", "TCS": "TCS"}
    )

    async def flaky_compute_atm_iv(service, symbol):
        if symbol == "BROKEN":
            raise ValueError("chain unavailable")
        return (0.30, 4000.0)

    monkeypatch.setattr(iv_universe_backfill, "compute_atm_iv", flaky_compute_atm_iv)
    monkeypatch.setattr(
        iv_universe_backfill, "async_session_maker", lambda: _FakeSessionContext(db_session)
    )

    await iv_universe_backfill.run_iv_universe_backfill(fast_settings)

    latest = {
        snapshot.symbol: snapshot
        for snapshot in await load_latest_snapshot_per_symbol(db_session)
    }
    assert "BROKEN" not in latest
    assert latest["TCS"].atm_iv == 0.30


@pytest.mark.asyncio
async def test_invalid_broker_token_stops_the_cycle_without_a_traceback(
    db_session: AsyncSession,
    fast_settings: Settings,
    active_broker_session: AsyncMock,
    monkeypatch,
):
    monkeypatch.setattr(iv_universe_backfill, "NSE_FO_SYMBOLS", {"NIFTY": "Nifty"})
    monkeypatch.setattr(
        iv_universe_backfill,
        "compute_atm_iv",
        AsyncMock(side_effect=BrokerAuthError("Fyers session token is invalid or expired")),
    )
    invalidate = AsyncMock()
    monkeypatch.setattr(iv_universe_backfill, "invalidate_broker_session", invalidate)
    monkeypatch.setattr(
        iv_universe_backfill,
        "async_session_maker",
        lambda: _FakeSessionContext(db_session),
    )

    await iv_universe_backfill.run_iv_universe_backfill(fast_settings)

    invalidate.assert_awaited_once_with()


@pytest.mark.asyncio
async def test_backfill_compares_current_iv_only_with_prior_observations(
    db_session: AsyncSession,
    fast_settings: Settings,
    active_broker_session: AsyncMock,
    monkeypatch,
):
    monkeypatch.setattr(iv_universe_backfill, "NSE_FO_SYMBOLS", {"TCS": "TCS"})
    today = datetime.now(UTC).date()
    for offset in range(1, MIN_IV_HISTORY_OBSERVATIONS + 1):
        await upsert_snapshot(
            db_session,
            symbol="TCS",
            snapshot_date=today - timedelta(days=offset),
            atm_iv=0.10 + offset * 0.001,
            spot=3800.0,
            iv_rank=None,
            iv_percentile=None,
        )

    monkeypatch.setattr(
        iv_universe_backfill,
        "compute_atm_iv",
        AsyncMock(return_value=(0.50, 3900.0)),
    )
    monkeypatch.setattr(
        iv_universe_backfill, "async_session_maker", lambda: _FakeSessionContext(db_session)
    )

    await iv_universe_backfill.run_iv_universe_backfill(fast_settings)

    latest = {
        snapshot.symbol: snapshot
        for snapshot in await load_latest_snapshot_per_symbol(db_session)
    }["TCS"]
    assert latest.iv_rank == 100.0
    assert latest.iv_percentile == 100.0


@pytest.mark.asyncio
async def test_backfill_repairs_stale_current_day_statistics(
    db_session: AsyncSession,
    fast_settings: Settings,
    active_broker_session: AsyncMock,
    monkeypatch,
):
    monkeypatch.setattr(iv_universe_backfill, "NSE_FO_SYMBOLS", {"TCS": "TCS"})
    today = datetime.now(UTC).date()
    for offset in range(1, MIN_IV_HISTORY_OBSERVATIONS + 1):
        await upsert_snapshot(
            db_session,
            symbol="TCS",
            snapshot_date=today - timedelta(days=offset),
            atm_iv=0.10 + offset * 0.001,
            spot=3800.0,
            iv_rank=None,
            iv_percentile=None,
        )
    await upsert_snapshot(
        db_session,
        symbol="TCS",
        snapshot_date=today,
        atm_iv=0.50,
        spot=3900.0,
        iv_rank=100.0,
        iv_percentile=95.0,
    )

    compute_atm_iv = AsyncMock()
    monkeypatch.setattr(iv_universe_backfill, "compute_atm_iv", compute_atm_iv)
    monkeypatch.setattr(
        iv_universe_backfill, "async_session_maker", lambda: _FakeSessionContext(db_session)
    )

    await iv_universe_backfill.run_iv_universe_backfill(fast_settings)

    latest = {
        snapshot.symbol: snapshot
        for snapshot in await load_latest_snapshot_per_symbol(db_session)
    }["TCS"]
    assert latest.iv_rank == 100.0
    assert latest.iv_percentile == 100.0
    compute_atm_iv.assert_not_awaited()


class _FakeSessionContext:
    """Hands back the shared test db_session instead of opening a new engine
    connection, since ``run_iv_universe_backfill`` opens its own sessions via
    ``async_session_maker()`` rather than taking one as an argument."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def __aenter__(self) -> AsyncSession:
        return self._session

    async def __aexit__(self, *exc_info) -> None:
        return None


class TestSeedSymbolHistoryIfNeeded:
    async def _seed(
        self, db_session: AsyncSession, settings: Settings, service: object = object(), **overrides
    ) -> bool:
        kwargs = dict(
            service=service,
            symbol="TCS",
            today=date(2026, 8, 6),
            settings=settings,
            from_date=date(2025, 7, 3),
        )
        kwargs.update(overrides)
        return await iv_universe_backfill._seed_symbol_history_if_needed(**kwargs)

    @pytest.mark.asyncio
    async def test_returns_false_when_seeding_is_disabled(
        self, db_session: AsyncSession, test_settings: Settings, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            iv_universe_backfill, "async_session_maker", lambda: _FakeSessionContext(db_session)
        )
        settings = test_settings.model_copy(
            update={"iv_universe_historical_seed_enabled": False}
        )

        assert await self._seed(db_session, settings) is False

    @pytest.mark.asyncio
    async def test_returns_false_when_the_broker_service_does_not_support_it(
        self, db_session: AsyncSession, test_settings: Settings, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            iv_universe_backfill, "async_session_maker", lambda: _FakeSessionContext(db_session)
        )
        settings = test_settings.model_copy(
            update={"iv_universe_historical_seed_enabled": True}
        )

        # A plain object() has no supports_historical_options attribute at all.
        assert await self._seed(db_session, settings) is False

    @pytest.mark.asyncio
    async def test_only_attempts_seeding_once_per_symbol_per_day(
        self, db_session: AsyncSession, test_settings: Settings, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            iv_universe_backfill, "async_session_maker", lambda: _FakeSessionContext(db_session)
        )
        settings = test_settings.model_copy(
            update={"iv_universe_historical_seed_enabled": True}
        )
        service = AsyncMock(supports_historical_options=True)
        seed_fn = AsyncMock(return_value=[])
        monkeypatch.setattr(iv_universe_backfill, "seed_historical_atm_iv", seed_fn)

        first = await self._seed(db_session, settings, service=service)
        second = await self._seed(db_session, settings, service=service)

        assert first is True
        assert second is False  # already attempted for (today, "TCS")
        seed_fn.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_skips_seeding_when_enough_prior_history_already_exists(
        self, db_session: AsyncSession, test_settings: Settings, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            iv_universe_backfill, "async_session_maker", lambda: _FakeSessionContext(db_session)
        )
        settings = test_settings.model_copy(
            update={"iv_universe_historical_seed_enabled": True}
        )
        for offset in range(1, MIN_IV_HISTORY_OBSERVATIONS + 1):
            await upsert_snapshot(
                db_session,
                symbol="TCS",
                snapshot_date=date(2026, 8, 6) - timedelta(days=offset),
                atm_iv=0.2,
                spot=3800.0,
                iv_rank=None,
                iv_percentile=None,
            )
        seed_fn = AsyncMock()
        monkeypatch.setattr(iv_universe_backfill, "seed_historical_atm_iv", seed_fn)
        service = AsyncMock(supports_historical_options=True)

        result = await self._seed(db_session, settings, service=service)

        assert result is False
        seed_fn.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_persists_only_genuinely_new_prior_day_observations(
        self, db_session: AsyncSession, test_settings: Settings, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            iv_universe_backfill, "async_session_maker", lambda: _FakeSessionContext(db_session)
        )
        settings = test_settings.model_copy(
            update={"iv_universe_historical_seed_enabled": True}
        )
        # One prior observation already exists for 2026-08-04.
        await upsert_snapshot(
            db_session, symbol="TCS", snapshot_date=date(2026, 8, 4),
            atm_iv=0.15, spot=3700.0, iv_rank=None, iv_percentile=None,
        )
        observations = [
            HistoricalIvObservation(date(2026, 8, 4), atm_iv=0.99, spot=9999.0),  # duplicate date
            HistoricalIvObservation(date(2026, 8, 5), atm_iv=0.22, spot=3800.0),  # new
            HistoricalIvObservation(date(2026, 8, 6), atm_iv=0.30, spot=3900.0),  # today, dropped
        ]
        monkeypatch.setattr(
            iv_universe_backfill, "seed_historical_atm_iv", AsyncMock(return_value=observations)
        )
        service = AsyncMock(supports_historical_options=True)

        result = await self._seed(db_session, settings, service=service)

        assert result is True
        history = await load_symbol_history(db_session, symbol="TCS", from_date=date(2025, 7, 3))
        by_date = {item.snapshot_date: item.atm_iv for item in history}
        assert by_date[date(2026, 8, 4)] == 0.15  # untouched — duplicate date was skipped
        assert by_date[date(2026, 8, 5)] == 0.22  # inserted
        assert date(2026, 8, 6) not in by_date  # today's own date is never backdated

    @pytest.mark.asyncio
    async def test_returns_true_and_logs_when_no_observations_are_available(
        self, db_session: AsyncSession, test_settings: Settings, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Still counts as "attempted" — must not retry every cycle for a
        symbol whose broker history genuinely doesn't go back far enough."""
        monkeypatch.setattr(
            iv_universe_backfill, "async_session_maker", lambda: _FakeSessionContext(db_session)
        )
        settings = test_settings.model_copy(
            update={"iv_universe_historical_seed_enabled": True}
        )
        monkeypatch.setattr(
            iv_universe_backfill, "seed_historical_atm_iv", AsyncMock(return_value=[])
        )
        service = AsyncMock(supports_historical_options=True)

        result = await self._seed(db_session, settings, service=service)

        assert result is True
        assert (date(2026, 8, 6), "TCS") in iv_universe_backfill._history_seed_attempted


@pytest.mark.asyncio
async def test_uses_the_live_fno_symbol_master_when_the_broker_supports_it(
    db_session: AsyncSession, fast_settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        iv_universe_backfill, "async_session_maker", lambda: _FakeSessionContext(db_session)
    )
    service = AsyncMock(supports_live_fno_symbol_master=True)
    from app.services.session_manager import session_manager

    await session_manager.set_session("TEST_CLIENT_001", service)
    live_universe = AsyncMock(return_value={"RELIANCE": "Reliance Industries"})
    monkeypatch.setattr(iv_universe_backfill.fno_symbol_store, "get", live_universe)
    monkeypatch.setattr(iv_universe_backfill, "NSE_FO_SYMBOLS", {"FALLBACK": "Fallback Corp"})
    compute_atm_iv = AsyncMock(return_value=(0.20, 2900.0))
    monkeypatch.setattr(iv_universe_backfill, "compute_atm_iv", compute_atm_iv)

    await iv_universe_backfill.run_iv_universe_backfill(fast_settings)

    live_universe.assert_awaited_once()
    compute_atm_iv.assert_awaited_once_with(service, "RELIANCE")
    await session_manager.clear()


@pytest.mark.asyncio
async def test_a_symbol_with_no_usable_quote_is_left_for_a_later_cycle(
    db_session: AsyncSession,
    fast_settings: Settings,
    active_broker_session: AsyncMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(iv_universe_backfill, "NSE_FO_SYMBOLS", {"ILLIQUID": "Illiquid Corp"})
    monkeypatch.setattr(
        iv_universe_backfill, "async_session_maker", lambda: _FakeSessionContext(db_session)
    )
    monkeypatch.setattr(iv_universe_backfill, "compute_atm_iv", AsyncMock(return_value=None))

    await iv_universe_backfill.run_iv_universe_backfill(fast_settings)

    latest = await load_latest_snapshot_per_symbol(db_session)
    assert latest == []  # nothing persisted — no usable quote to persist


@pytest.mark.asyncio
async def test_loop_runs_immediately_then_stops_on_the_stop_event(
    fast_settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = 0

    async def fake_run(_settings: Settings) -> None:
        nonlocal calls
        calls += 1
        stop_event.set()

    monkeypatch.setattr(iv_universe_backfill, "run_iv_universe_backfill", fake_run)
    stop_event = asyncio.Event()

    await iv_universe_backfill.iv_universe_backfill_loop(fast_settings, stop_event)

    assert calls == 1


@pytest.mark.asyncio
async def test_loop_survives_a_cycle_that_raises_outside_the_per_symbol_guard(
    fast_settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Regression test for the bug found while writing these tests:
    run_iv_universe_backfill only guards its per-symbol body — a failure in
    the setup/teardown around it (async_session_maker, fno_symbol_store,
    the stats refresh) used to propagate out of iv_universe_backfill_loop's
    while loop and permanently end IV backfill for the process's life."""
    settings = fast_settings.model_copy(
        update={"iv_universe_backfill_interval_seconds": 0.01}
    )
    attempts = 0

    async def flaky_run(_settings: Settings) -> None:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("async_session_maker() failed: pool exhausted")
        stop_event.set()

    monkeypatch.setattr(iv_universe_backfill, "run_iv_universe_backfill", flaky_run)
    stop_event = asyncio.Event()

    await iv_universe_backfill.iv_universe_backfill_loop(settings, stop_event)  # must not raise

    assert attempts == 2
