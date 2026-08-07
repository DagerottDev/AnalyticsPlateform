"""Scheduled ATM-IV/IV-Rank/IV-Percentile backfill across all NSE F&O stocks.

Computing this live per page load doesn't scale past a handful of symbols
under Fyers' rate limits (see the 6-symbol cap on ``/volatility/compare``), so
instead this walks the full F&O universe on a timer and persists one
row per symbol per day into ``fo_iv_universe_snapshots``. The screener
endpoint then only ever reads that table, so it stays fast regardless of
universe size. Current-day rows are refreshed after a bounded interval, and
Fyers sessions may optionally seed prior ATM-IV observations from daily option
candles so rank/percentile become useful without waiting a full month.
"""

import asyncio
import logging
from datetime import UTC, date, datetime, timedelta
from datetime import time as datetime_time
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.core.exceptions import BrokerRateLimitError, is_broker_auth_error
from app.data.nse_fo_symbols import NSE_FO_SYMBOLS
from app.db.session import async_session_maker
from app.services.atm_iv import compute_atm_iv
from app.services.broker_session_store import invalidate_broker_session
from app.services.fno_symbol_store import fno_symbol_store
from app.services.fo_iv_universe_store import (
    load_snapshots_for_date,
    load_symbol_history,
    upsert_snapshot,
)
from app.services.iv_history_seed import seed_historical_atm_iv
from app.services.iv_stats import MIN_IV_HISTORY_OBSERVATIONS, iv_percentile, iv_rank
from app.services.session_manager import session_manager

logger = logging.getLogger(__name__)

# One year of daily observations is enough for a stable rank/percentile
# without the history query scanning an unbounded table.
_HISTORY_LOOKBACK_DAYS = 400
_history_seed_attempted: set[tuple[date, str]] = set()
IST = ZoneInfo("Asia/Kolkata")


def _utc_now() -> datetime:
    return datetime.now(UTC)


def next_scheduled_run(now: datetime, settings: Settings) -> datetime:
    """Return the next weekday post-market IV run in UTC."""
    local_now = now.astimezone(IST)
    for offset in range(8):
        run_date = local_now.date() + timedelta(days=offset)
        if run_date.weekday() >= 5:
            continue
        candidate = datetime.combine(
            run_date,
            datetime_time(
                hour=settings.iv_universe_backfill_hour_ist,
                minute=settings.iv_universe_backfill_minute_ist,
            ),
            tzinfo=IST,
        )
        if candidate > local_now:
            return candidate.astimezone(UTC)
    raise RuntimeError("Unable to calculate the next IV-universe run")


def is_post_market_run_due(
    now: datetime, settings: Settings, last_successful_date: date | None
) -> bool:
    local_now = now.astimezone(IST)
    scheduled = datetime_time(
        hour=settings.iv_universe_backfill_hour_ist,
        minute=settings.iv_universe_backfill_minute_ist,
    )
    return (
        local_now.weekday() < 5
        and local_now.time().replace(tzinfo=None) >= scheduled
        and last_successful_date != local_now.date()
    )


async def _wait_or_stop(stop_event: asyncio.Event, seconds: float) -> None:
    try:
        await asyncio.wait_for(stop_event.wait(), timeout=max(0.0, seconds))
    except TimeoutError:
        return


def _snapshot_is_due(
    snapshot: object | None, *, now: datetime, refresh_interval_seconds: float
) -> bool:
    """Return whether a current-day row needs another broker snapshot."""
    if snapshot is None:
        return True
    updated_at = getattr(snapshot, "updated_at", None)
    if not isinstance(updated_at, datetime):
        return True
    if updated_at.tzinfo is None:
        updated_at = updated_at.replace(tzinfo=UTC)
    return (now - updated_at).total_seconds() >= refresh_interval_seconds


async def _seed_symbol_history_if_needed(
    service: object,
    symbol: str,
    *,
    today: date,
    settings: Settings,
    from_date: date,
) -> bool:
    """Seed one symbol at most once per process/day when true option history exists."""
    if not settings.iv_universe_historical_seed_enabled:
        return False
    if getattr(service, "supports_historical_options", False) is not True:
        return False
    key = (today, symbol)
    if key in _history_seed_attempted:
        return False

    async with async_session_maker() as db:
        history = await load_symbol_history(db, symbol=symbol, from_date=from_date)
    prior_history = [item for item in history if item.snapshot_date < today]
    if len(prior_history) >= MIN_IV_HISTORY_OBSERVATIONS:
        return False

    _history_seed_attempted.add(key)
    observations = await seed_historical_atm_iv(
        service,
        symbol,
        today=today,
        lookback_days=settings.iv_universe_historical_seed_lookback_days,
        request_delay_seconds=settings.iv_universe_backfill_symbol_delay_seconds,
    )
    if not observations:
        logger.info("No historical ATM-IV seed available for %s", symbol)
        return True

    existing_dates = {item.snapshot_date for item in history}
    async with async_session_maker() as db:
        inserted = 0
        for observation in observations:
            if observation.snapshot_date >= today or observation.snapshot_date in existing_dates:
                continue
            await upsert_snapshot(
                db,
                symbol=symbol,
                snapshot_date=observation.snapshot_date,
                atm_iv=observation.atm_iv,
                spot=observation.spot,
                iv_rank=None,
                iv_percentile=None,
            )
            inserted += 1
    logger.info("Seeded %s historical ATM-IV observations for %s", inserted, symbol)
    return True


async def run_iv_universe_backfill(settings: Settings) -> bool:
    """Capture due ATM-IV observations and optionally seed prior history."""
    today = _utc_now().date()
    from_date = today - timedelta(days=_HISTORY_LOOKBACK_DAYS)
    now = _utc_now()
    async with async_session_maker() as db:
        current_snapshots = await load_snapshots_for_date(db, today)
        await _refresh_current_day_stats(db, today, from_date)

    service = session_manager.get_active_session()
    if service is None:
        logger.info("Skipping IV universe backfill: no active broker session")
        return False

    universe = NSE_FO_SYMBOLS
    if getattr(service, "supports_live_fno_symbol_master", False) is True:
        universe = await fno_symbol_store.get(NSE_FO_SYMBOLS)

    snapshots_by_symbol = {snapshot.symbol: snapshot for snapshot in current_snapshots}
    pending = [
        symbol
        for symbol in universe
        if _snapshot_is_due(
            snapshots_by_symbol.get(symbol),
            now=now,
            refresh_interval_seconds=settings.iv_universe_snapshot_refresh_interval_seconds,
        )
    ]
    if not pending:
        return True

    seed_attempts = 0
    incomplete = False
    for symbol in pending:
        try:
            result = await compute_atm_iv(service, symbol)
            if result is None:
                incomplete = True
                logger.info("No usable live ATM-IV quote for %s; retrying later", symbol)
                await asyncio.sleep(settings.iv_universe_backfill_symbol_delay_seconds)
                continue
            atm_iv, spot = result
            if (
                seed_attempts < settings.iv_universe_historical_seed_symbols_per_cycle
                and await _seed_symbol_history_if_needed(
                    service,
                    symbol,
                    today=today,
                    settings=settings,
                    from_date=from_date,
                )
            ):
                seed_attempts += 1
            async with async_session_maker() as db:
                history = await load_symbol_history(db, symbol=symbol, from_date=from_date)
                historical_ivs = [
                    snapshot.atm_iv
                    for snapshot in history
                    if snapshot.snapshot_date != today
                ]
                rank = (
                    iv_rank(historical_ivs, atm_iv)
                    if len(historical_ivs) >= MIN_IV_HISTORY_OBSERVATIONS
                    else None
                )
                percentile = (
                    iv_percentile(historical_ivs, atm_iv)
                    if len(historical_ivs) >= MIN_IV_HISTORY_OBSERVATIONS
                    else None
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
        except BrokerRateLimitError:
            # Broker capacity is shared with every interactive view. Stop the
            # whole background cycle at the first explicit 429; the scheduler
            # retries after a cooldown instead of hammering the remaining
            # universe and starving user-facing option-chain requests.
            logger.warning(
                "Pausing IV universe backfill after broker rate limit at %s",
                symbol,
            )
            raise
        except Exception as exc:
            if is_broker_auth_error(exc):
                logger.warning(
                    "Stopping IV universe backfill: broker session is invalid or expired. "
                    "Reconnect the broker to resume live data."
                )
                await invalidate_broker_session()
                return False
            # One unavailable chain should not stop the rest of the universe
            # from being captured this cycle.
            incomplete = True
            logger.exception("IV universe backfill failed for %s", symbol)
        await asyncio.sleep(settings.iv_universe_backfill_symbol_delay_seconds)

    # A newly seeded history can make already-persisted current rows ready for
    # rank/percentile without requiring another broker quote cycle.
    async with async_session_maker() as db:
        await _refresh_current_day_stats(db, today, from_date)
    # Successful rows are skipped on the retry, so returning False here lets
    # the scheduler revisit only missing/unavailable symbols after cooldown.
    return not incomplete


async def _refresh_current_day_stats(
    db: AsyncSession, snapshot_date: date, from_date: date
) -> None:
    """Repair today's persisted ranks after a formula change without broker calls."""
    current_snapshots = await load_snapshots_for_date(db, snapshot_date)
    for snapshot in current_snapshots:
        history = await load_symbol_history(db, symbol=snapshot.symbol, from_date=from_date)
        historical_ivs = [
            item.atm_iv for item in history if item.snapshot_date != snapshot.snapshot_date
        ]
        if len(historical_ivs) >= MIN_IV_HISTORY_OBSERVATIONS:
            snapshot.iv_rank = iv_rank(historical_ivs, snapshot.atm_iv)
            snapshot.iv_percentile = iv_percentile(historical_ivs, snapshot.atm_iv)
        else:
            snapshot.iv_rank = None
            snapshot.iv_percentile = None
    if current_snapshots:
        await db.commit()


async def iv_universe_backfill_loop(settings: Settings, stop_event: asyncio.Event) -> None:
    """Run once after the weekday market close, retrying only on cooldown."""
    last_successful_date: date | None = None
    while not stop_event.is_set():
        now = _utc_now()
        if not is_post_market_run_due(now, settings, last_successful_date):
            next_run = next_scheduled_run(now, settings)
            logger.info("Next IV universe backfill scheduled for %s", next_run.astimezone(IST))
            await _wait_or_stop(stop_event, (next_run - now).total_seconds())
            continue

        try:
            completed = await run_iv_universe_backfill(settings)
        except BrokerRateLimitError as exc:
            cooldown = max(settings.iv_universe_backfill_retry_seconds, exc.retry_after)
            logger.warning(
                "IV universe backfill rate-limited; retrying post-market in %.0fs",
                cooldown,
            )
            await _wait_or_stop(stop_event, cooldown)
            continue
        except Exception:
            logger.exception("IV universe backfill cycle failed; retrying post-market")
            completed = False

        if completed:
            last_successful_date = _utc_now().astimezone(IST).date()
            continue
        await _wait_or_stop(stop_event, settings.iv_universe_backfill_retry_seconds)
