"""Scheduled ATM-IV/IV-Rank/IV-Percentile backfill across all NSE F&O stocks.

Computing this live per page load doesn't scale past a handful of symbols
under Fyers' rate limits (see the 6-symbol cap on ``/volatility/compare``), so
instead this walks the full F&O universe on a timer and persists one
row per symbol per day into ``fo_iv_universe_snapshots``. The screener
endpoint then only ever reads that table, so it stays fast regardless of
universe size. Symbols already captured today are skipped on repeat runs, so
after the first full pass a cycle costs near-zero broker calls except retries
for symbols that failed earlier.
"""

import asyncio
import logging
from datetime import UTC, datetime, timedelta

from app.config import Settings
from app.core.exceptions import is_broker_auth_error
from app.data.nse_fo_symbols import NSE_FO_SYMBOLS
from app.db.session import async_session_maker
from app.services.atm_iv import compute_atm_iv
from app.services.broker_session_store import invalidate_broker_session
from app.services.fo_iv_universe_store import (
    load_snapshotted_symbols_today,
    load_symbol_history,
    upsert_snapshot,
)
from app.services.iv_stats import iv_percentile, iv_rank
from app.services.session_manager import session_manager

logger = logging.getLogger(__name__)

# One year of daily observations is enough for a stable rank/percentile
# without the history query scanning an unbounded table.
_HISTORY_LOOKBACK_DAYS = 400


async def run_iv_universe_backfill(settings: Settings) -> None:
    """Capture one ATM-IV observation per not-yet-captured F&O symbol today."""
    service = session_manager.get_active_session()
    if service is None:
        logger.info("Skipping IV universe backfill: no active broker session")
        return

    today = datetime.now(UTC).date()
    async with async_session_maker() as db:
        already_captured = await load_snapshotted_symbols_today(db, today)
    pending = [symbol for symbol in NSE_FO_SYMBOLS if symbol not in already_captured]
    if not pending:
        return

    from_date = today - timedelta(days=_HISTORY_LOOKBACK_DAYS)
    for symbol in pending:
        try:
            result = await compute_atm_iv(service, symbol)
            if result is None:
                continue
            atm_iv, spot = result
            async with async_session_maker() as db:
                history = await load_symbol_history(db, symbol=symbol, from_date=from_date)
                historical_ivs = [snapshot.atm_iv for snapshot in history]
                rank = iv_rank([*historical_ivs, atm_iv], atm_iv) if historical_ivs else None
                percentile = (
                    iv_percentile([*historical_ivs, atm_iv], atm_iv) if historical_ivs else None
                )
                await upsert_snapshot(
                    db,
                    symbol=symbol,
                    snapshot_date=today,
                    atm_iv=atm_iv,
                    spot=spot,
                    iv_rank=rank,
                    iv_percentile=percentile,
                )
        except Exception as exc:
            if is_broker_auth_error(exc):
                logger.warning(
                    "Stopping IV universe backfill: broker session is invalid or expired. "
                    "Reconnect the broker to resume live data."
                )
                await invalidate_broker_session()
                return
            # One unavailable chain should not stop the rest of the universe
            # from being captured this cycle.
            logger.exception("IV universe backfill failed for %s", symbol)
        await asyncio.sleep(settings.iv_universe_backfill_symbol_delay_seconds)


async def iv_universe_backfill_loop(settings: Settings, stop_event: asyncio.Event) -> None:
    """Run immediately, then repeat at the configured interval until shutdown."""
    while not stop_event.is_set():
        await run_iv_universe_backfill(settings)
        stop_wait = asyncio.create_task(stop_event.wait())
        done, pending = await asyncio.wait(
            {stop_wait},
            timeout=settings.iv_universe_backfill_interval_seconds,
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
