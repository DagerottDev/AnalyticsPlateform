"""Scheduled, idempotent daily OHLCV backfill for the local market-data store."""

import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.db.session import async_session_maker
from app.models.market_data import MarketData
from app.services.fyers_service import to_fyers_ws_symbol
from app.services.session_manager import session_manager

logger = logging.getLogger(__name__)
_backfill_requested = asyncio.Event()


@dataclass(frozen=True)
class BackfillResult:
    symbol: str
    fetched: int
    persisted: int


async def backfill_symbol(
    db: AsyncSession,
    service: Any,
    *,
    symbol: str,
    initial_lookback_days: int,
    overlap_days: int,
) -> BackfillResult:
    """Fetch and upsert one symbol's daily candles.

    A small overlap lets a later job correct the still-forming most-recent
    daily candle. ``AsyncSession.merge`` makes those overlapping writes
    idempotent across PostgreSQL and the SQLite test database.
    """
    normalized_symbol = symbol.strip().upper()
    latest = (
        await db.execute(
            select(MarketData.timestamp)
            .where(MarketData.trading_symbol == normalized_symbol)
            .order_by(MarketData.timestamp.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    now = datetime.now(UTC)
    from_date = (
        latest - timedelta(days=overlap_days)
        if latest is not None
        else now - timedelta(days=initial_lookback_days)
    )
    candles = await service.get_historical_data(
        to_fyers_ws_symbol(normalized_symbol),
        from_date.strftime("%Y-%m-%d"),
        now.strftime("%Y-%m-%d"),
        "D",
    )

    for candle in candles:
        await db.merge(
            MarketData(
                timestamp=candle["timestamp"],
                trading_symbol=normalized_symbol,
                open=float(candle["open"]),
                high=float(candle["high"]),
                low=float(candle["low"]),
                close=float(candle["close"]),
                volume=int(candle.get("volume") or 0),
                open_interest=int(candle.get("open_interest") or 0),
            )
        )
    if candles:
        await db.commit()
    return BackfillResult(normalized_symbol, fetched=len(candles), persisted=len(candles))


async def run_market_data_backfill(settings: Settings) -> list[BackfillResult]:
    """Backfill every configured symbol for the currently active broker session."""
    service = session_manager.get_active_session()
    if service is None:
        logger.info("Skipping market-data backfill: no active broker session")
        return []

    results: list[BackfillResult] = []
    async with async_session_maker() as db:
        for symbol in settings.market_data_backfill_symbol_list:
            try:
                result = await backfill_symbol(
                    db,
                    service,
                    symbol=symbol,
                    initial_lookback_days=settings.market_data_backfill_initial_lookback_days,
                    overlap_days=settings.market_data_backfill_overlap_days,
                )
                results.append(result)
                logger.info(
                    "Market-data backfill completed for %s (%s candles)",
                    result.symbol,
                    result.persisted,
                )
            except Exception:
                # One unavailable symbol should not stop the remainder of
                # the configured watchlist from being persisted.
                logger.exception("Market-data backfill failed for %s", symbol)
    return results


def request_market_data_backfill() -> None:
    """Wake the scheduler after a broker login establishes a new session."""
    _backfill_requested.set()


async def market_data_backfill_loop(settings: Settings, stop_event: asyncio.Event) -> None:
    """Run immediately, then repeat at the configured interval until shutdown."""
    while not stop_event.is_set():
        await run_market_data_backfill(settings)
        stop_wait = asyncio.create_task(stop_event.wait())
        requested_wait = asyncio.create_task(_backfill_requested.wait())
        done, pending = await asyncio.wait(
            {stop_wait, requested_wait},
            timeout=settings.market_data_backfill_interval_seconds,
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
        if requested_wait in done:
            _backfill_requested.clear()
