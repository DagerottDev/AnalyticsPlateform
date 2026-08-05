from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.open_interest_snapshot import OpenInterestSnapshot
from app.services.open_interest_snapshots import (
    aggregate_instruments,
    capture_expiry,
    is_regular_market_open,
    load_history,
    purge_expired,
    store_snapshot,
)


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
