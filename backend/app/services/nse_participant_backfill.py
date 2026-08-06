"""Scheduled retrieval of official NSE F&O participant reports."""

import asyncio
import logging
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from app.config import Settings
from app.db.session import async_session_maker
from app.services.nse_participant_provider import (
    NseParticipantProvider,
    ParticipantReportUnavailableError,
)
from app.services.nse_participant_store import (
    ensure_import_state,
    existing_report_dates,
    record_attempt,
    set_backfill_completed,
    upsert_report,
)

logger = logging.getLogger(__name__)
IST = ZoneInfo("Asia/Kolkata")


def _weekdays_between(start: date, end: date) -> list[date]:
    days: list[date] = []
    current = start
    while current <= end:
        if current.weekday() < 5:
            days.append(current)
        current += timedelta(days=1)
    return days


async def _fetch_and_store(
    provider: NseParticipantProvider, trade_date: date
) -> bool:
    try:
        rows = await provider.fetch(trade_date)
    except ParticipantReportUnavailableError as exc:
        async with async_session_maker() as db:
            await record_attempt(db, error=str(exc))
        return False
    async with async_session_maker() as db:
        await upsert_report(db, trade_date=trade_date, rows=rows)
        await record_attempt(db, error=None, latest_trade_date=trade_date)
    return True


async def run_participant_data_refresh(
    settings: Settings,
    *,
    now: datetime | None = None,
    provider: NseParticipantProvider | None = None,
) -> None:
    """Fetch the last publication first, then make bounded backfill progress."""
    observed_at = now or datetime.now(UTC)
    today = observed_at.astimezone(IST).date()
    latest_candidate = today - timedelta(days=1)
    target_start = today - timedelta(days=settings.participant_data_history_days)
    source = provider or NseParticipantProvider()

    async with async_session_maker() as db:
        await ensure_import_state(db, backfill_target_start_date=target_start)
        present_dates = await existing_report_dates(db, start=target_start, end=latest_candidate)

    # Participant files are normally next-day publications. A just-published
    # report can be briefly unavailable, so retain the last valid data and
    # retry it in later cycles instead of marking the dataset empty.
    if latest_candidate.weekday() < 5 and latest_candidate not in present_dates:
        await _fetch_and_store(source, latest_candidate)

    async with async_session_maker() as db:
        present_dates = await existing_report_dates(db, start=target_start, end=latest_candidate)
    missing_dates = list(reversed([
        trade_date
        for trade_date in _weekdays_between(target_start, latest_candidate)
        if trade_date not in present_dates and trade_date != latest_candidate
    ]))
    for trade_date in missing_dates[: settings.participant_data_backfill_batch_size]:
        await _fetch_and_store(source, trade_date)
        await asyncio.sleep(settings.participant_data_request_delay_seconds)

    # Exchange holidays do not have participant files. Once the bounded final
    # batch has been attempted, mark the initial import complete while the
    # regular loop continues retrying any missing report dates opportunistically.
    if len(missing_dates) <= settings.participant_data_backfill_batch_size:
        async with async_session_maker() as db:
            await set_backfill_completed(db)


async def participant_data_loop(settings: Settings, stop_event: asyncio.Event) -> None:
    """Run immediately at startup and then poll NSE at a respectful cadence."""
    while not stop_event.is_set():
        try:
            await run_participant_data_refresh(settings)
        except Exception:
            logger.exception("NSE participant-data refresh failed")
        try:
            await asyncio.wait_for(
                stop_event.wait(), timeout=settings.participant_data_poll_interval_seconds
            )
        except TimeoutError:
            continue
