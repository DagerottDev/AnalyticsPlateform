"""Tests for durable, idempotent daily-candle backfills."""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.market_data import MarketData
from app.services.market_data_backfill import backfill_symbol


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
