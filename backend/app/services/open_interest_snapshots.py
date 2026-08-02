"""Collection and lookup for live expiry-level Call/Put OI history."""

import asyncio
import logging
import math
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.db.session import async_session_maker
from app.models.open_interest_snapshot import OpenInterestSnapshot
from app.services.session_manager import session_manager

logger = logging.getLogger(__name__)

IST = ZoneInfo("Asia/Kolkata")


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def is_regular_market_open(now: datetime | None = None) -> bool:
    local = (now or datetime.now(UTC)).astimezone(IST)
    minutes = local.hour * 60 + local.minute
    return local.weekday() < 5 and (9 * 60 + 15) <= minutes < (15 * 60 + 30)


def bucket_timestamp(now: datetime, interval_seconds: float) -> datetime:
    """Round down to the configured collector bucket in UTC."""
    seconds = max(1, int(interval_seconds))
    value = _as_utc(now)
    epoch = int(value.timestamp())
    return datetime.fromtimestamp(epoch - (epoch % seconds), tz=UTC)


def _finite(value: object) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int | float) and math.isfinite(value):
        return float(value)
    return None


def aggregate_instruments(
    instruments: list[dict[str, object]], expiry: str
) -> tuple[float, float, float, float] | None:
    """Sum usable broker option-chain fields for one expiry."""
    call_oi = put_oi = call_change = put_change = 0.0
    saw_oi = False
    for instrument in instruments:
        if str(instrument.get("expiry") or "") != expiry:
            continue
        oi = _finite(instrument.get("oi"))
        if oi is None:
            continue
        option_type = instrument.get("option_type")
        change = _finite(instrument.get("oi_change")) or 0.0
        if option_type == "CE":
            call_oi += oi
            call_change += change
            saw_oi = True
        elif option_type == "PE":
            put_oi += oi
            put_change += change
            saw_oi = True
    return (call_oi, put_oi, call_change, put_change) if saw_oi else None


def _expiry_sort_key(expiry: str) -> datetime:
    for format_string in ("%d-%b-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(expiry, format_string)
        except ValueError:
            continue
    return datetime.max


def nearest_expiry(instruments: list[dict[str, object]]) -> str | None:
    expiries = {
        str(instrument.get("expiry"))
        for instrument in instruments
        if instrument.get("expiry") and instrument.get("option_type") in {"CE", "PE"}
    }
    return min(expiries, key=_expiry_sort_key) if expiries else None


async def store_snapshot(
    db: AsyncSession,
    *,
    owner_id: str,
    symbol: str,
    expiry: str,
    observed_at: datetime,
    interval_seconds: float,
    values: tuple[float, float, float, float],
) -> OpenInterestSnapshot:
    timestamp = bucket_timestamp(observed_at, interval_seconds)
    key = (owner_id, symbol.upper(), expiry, timestamp)
    snapshot = await db.get(OpenInterestSnapshot, key)
    if snapshot is None:
        snapshot = OpenInterestSnapshot(
            owner_id=owner_id,
            symbol=symbol.upper(),
            expiry=expiry,
            timestamp=timestamp,
            total_call_oi=values[0],
            total_put_oi=values[1],
            total_call_change=values[2],
            total_put_change=values[3],
        )
        db.add(snapshot)
    else:
        (
            snapshot.total_call_oi,
            snapshot.total_put_oi,
            snapshot.total_call_change,
            snapshot.total_put_change,
        ) = values
    await db.commit()
    return snapshot


def trading_day_cutoff(now: datetime, trading_days: int) -> datetime:
    """Weekday-based trading-day retention; exchange holidays stay broker-owned."""
    current = _as_utc(now)
    remaining = max(1, trading_days)
    while remaining:
        current -= timedelta(days=1)
        if current.astimezone(IST).weekday() < 5:
            remaining -= 1
    return current


async def purge_expired(db: AsyncSession, *, now: datetime, trading_days: int) -> None:
    await db.execute(
        delete(OpenInterestSnapshot).where(
            OpenInterestSnapshot.timestamp < trading_day_cutoff(now, trading_days)
        )
    )
    await db.commit()


async def capture_expiry(
    db: AsyncSession,
    service: Any,
    *,
    owner_id: str,
    symbol: str,
    expiry: str,
    interval_seconds: float,
    observed_at: datetime | None = None,
    instruments: list[dict[str, object]] | None = None,
) -> OpenInterestSnapshot | None:
    raw = instruments if instruments is not None else await service.get_instruments(symbol.upper())
    values = aggregate_instruments(raw, expiry)
    if values is None:
        return None
    return await store_snapshot(
        db,
        owner_id=owner_id,
        symbol=symbol,
        expiry=expiry,
        observed_at=observed_at or datetime.now(UTC),
        interval_seconds=interval_seconds,
        values=values,
    )


async def capture_scheduled_snapshots(settings: Settings, now: datetime | None = None) -> int:
    """Capture nearest expiries for configured underlyings under the active owner."""
    observed_at = now or datetime.now(UTC)
    if not is_regular_market_open(observed_at):
        return 0
    service = session_manager.get_active_session()
    owner_id = session_manager.get_active_client_id()
    if service is None or owner_id is None:
        return 0

    captured = 0
    async with async_session_maker() as db:
        for symbol in settings.market_data_backfill_symbol_list:
            try:
                instruments = await service.get_instruments(symbol)
                expiry = nearest_expiry(instruments)
                if expiry is None:
                    continue
                snapshot = await capture_expiry(
                    db,
                    service,
                    owner_id=owner_id,
                    symbol=symbol,
                    expiry=expiry,
                    interval_seconds=settings.open_interest_snapshot_interval_seconds,
                    observed_at=observed_at,
                    instruments=instruments,
                )
                captured += int(snapshot is not None)
            except Exception:
                logger.exception("Open-interest snapshot failed for %s", symbol)
        await purge_expired(
            db,
            now=observed_at,
            trading_days=settings.open_interest_snapshot_retention_trading_days,
        )
    return captured


async def open_interest_snapshot_loop(settings: Settings, stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        await capture_scheduled_snapshots(settings)
        try:
            await asyncio.wait_for(
                stop_event.wait(), timeout=settings.open_interest_snapshot_interval_seconds
            )
        except TimeoutError:
            continue


async def load_history(
    db: AsyncSession,
    *,
    owner_id: str,
    symbol: str,
    expiry: str,
    session_date: date | None = None,
) -> tuple[date | None, list[OpenInterestSnapshot]]:
    base = select(OpenInterestSnapshot).where(
        OpenInterestSnapshot.owner_id == owner_id,
        OpenInterestSnapshot.symbol == symbol.upper(),
        OpenInterestSnapshot.expiry == expiry,
    )
    if session_date is None:
        latest = (
            await db.execute(base.order_by(OpenInterestSnapshot.timestamp.desc()).limit(1))
        ).scalar_one_or_none()
        if latest is None:
            return None, []
        session_date = _as_utc(latest.timestamp).astimezone(IST).date()
    start = datetime.combine(session_date, time.min, tzinfo=IST).astimezone(UTC)
    end = start + timedelta(days=1)
    result = await db.execute(
        base.where(
            OpenInterestSnapshot.timestamp >= start,
            OpenInterestSnapshot.timestamp < end,
        ).order_by(OpenInterestSnapshot.timestamp)
    )
    return session_date, list(result.scalars())
