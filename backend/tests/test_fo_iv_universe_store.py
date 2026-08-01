"""Tests for the F&O IV universe screener's database operations."""

from datetime import date

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.fo_iv_universe_store import (
    load_latest_snapshot_per_symbol,
    load_snapshotted_symbols_today,
    load_symbol_history,
    upsert_snapshot,
)


@pytest.mark.asyncio
async def test_upsert_creates_then_refreshes_same_day_row(db_session: AsyncSession):
    first = await upsert_snapshot(
        db_session,
        symbol="reliance",
        snapshot_date=date(2026, 7, 31),
        atm_iv=0.18,
        spot=2900.0,
        iv_rank=None,
        iv_percentile=None,
    )
    second = await upsert_snapshot(
        db_session,
        symbol="RELIANCE",
        snapshot_date=date(2026, 7, 31),
        atm_iv=0.22,
        spot=2950.0,
        iv_rank=40.0,
        iv_percentile=60.0,
    )

    history = await load_symbol_history(db_session, symbol="RELIANCE", from_date=date.min)
    assert first.symbol == "RELIANCE"
    assert len(history) == 1
    assert second.atm_iv == 0.22
    assert history[0].atm_iv == 0.22
    assert history[0].spot == 2950.0


@pytest.mark.asyncio
async def test_load_snapshotted_symbols_today_only_returns_todays_rows(db_session: AsyncSession):
    await upsert_snapshot(
        db_session,
        symbol="TCS",
        snapshot_date=date(2026, 7, 31),
        atm_iv=0.20,
        spot=None,
        iv_rank=None,
        iv_percentile=None,
    )
    await upsert_snapshot(
        db_session,
        symbol="INFY",
        snapshot_date=date(2026, 7, 30),
        atm_iv=0.19,
        spot=None,
        iv_rank=None,
        iv_percentile=None,
    )

    captured_today = await load_snapshotted_symbols_today(db_session, date(2026, 7, 31))
    assert captured_today == {"TCS"}


@pytest.mark.asyncio
async def test_load_latest_snapshot_per_symbol_picks_most_recent_row(db_session: AsyncSession):
    await upsert_snapshot(
        db_session,
        symbol="TCS",
        snapshot_date=date(2026, 7, 30),
        atm_iv=0.19,
        spot=None,
        iv_rank=None,
        iv_percentile=None,
    )
    await upsert_snapshot(
        db_session,
        symbol="TCS",
        snapshot_date=date(2026, 7, 31),
        atm_iv=0.21,
        spot=None,
        iv_rank=None,
        iv_percentile=None,
    )
    await upsert_snapshot(
        db_session,
        symbol="INFY",
        snapshot_date=date(2026, 7, 31),
        atm_iv=0.15,
        spot=None,
        iv_rank=None,
        iv_percentile=None,
    )

    latest = await load_latest_snapshot_per_symbol(db_session)
    by_symbol = {snapshot.symbol: snapshot for snapshot in latest}
    assert len(latest) == 2
    assert by_symbol["TCS"].snapshot_date == date(2026, 7, 31)
    assert by_symbol["TCS"].atm_iv == 0.21
    assert by_symbol["INFY"].atm_iv == 0.15
