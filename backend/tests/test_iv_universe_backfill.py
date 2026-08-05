"""Tests for the scheduled F&O IV universe backfill job."""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.core.exceptions import BrokerAuthError
from app.services import iv_universe_backfill
from app.services.fo_iv_universe_store import (
    load_latest_snapshot_per_symbol,
    upsert_snapshot,
)
from app.services.iv_stats import MIN_IV_HISTORY_OBSERVATIONS


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
