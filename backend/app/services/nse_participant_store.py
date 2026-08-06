"""Persistence and query helpers for NSE participant reports."""

from datetime import UTC, date, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.nse_participant_snapshot import NseParticipantImportState, NseParticipantSnapshot
from app.services.nse_participant_provider import METRICS, ParticipantReportRow

NSE_PARTICIPANT_SOURCE = "NSE_FO_PARTICIPANT"


async def get_import_state(db: AsyncSession) -> NseParticipantImportState | None:
    return await db.get(NseParticipantImportState, NSE_PARTICIPANT_SOURCE)


async def ensure_import_state(
    db: AsyncSession, *, backfill_target_start_date: date
) -> NseParticipantImportState:
    state = await get_import_state(db)
    if state is None:
        state = NseParticipantImportState(
            source=NSE_PARTICIPANT_SOURCE,
            backfill_target_start_date=backfill_target_start_date,
        )
        db.add(state)
        await db.commit()
    elif state.backfill_target_start_date is None:
        state.backfill_target_start_date = backfill_target_start_date
        await db.commit()
    return state


async def record_attempt(
    db: AsyncSession, *, error: str | None, latest_trade_date: date | None = None
) -> NseParticipantImportState:
    state = await ensure_import_state(db, backfill_target_start_date=date.today())
    now = datetime.now(UTC)
    state.last_attempt_at = now
    state.last_error = error[:1000] if error else None
    if error is None:
        state.last_success_at = now
        if latest_trade_date is not None and (
            state.last_successful_trade_date is None
            or latest_trade_date > state.last_successful_trade_date
        ):
            state.last_successful_trade_date = latest_trade_date
    await db.commit()
    return state


async def set_backfill_completed(db: AsyncSession) -> None:
    state = await get_import_state(db)
    if state is not None and state.backfill_completed_at is None:
        state.backfill_completed_at = datetime.now(UTC)
        await db.commit()


async def upsert_report(
    db: AsyncSession, *, trade_date: date, rows: list[ParticipantReportRow]
) -> list[NseParticipantSnapshot]:
    now = datetime.now(UTC)
    snapshots: list[NseParticipantSnapshot] = []
    for row in rows:
        snapshot = await db.get(NseParticipantSnapshot, (trade_date, row.participant_type))
        if snapshot is None:
            snapshot = NseParticipantSnapshot(
                trade_date=trade_date,
                participant_type=row.participant_type,
                updated_at=now,
            )
            db.add(snapshot)
        for metric in METRICS:
            setattr(snapshot, f"oi_{metric}", row.oi[metric])
            setattr(snapshot, f"volume_{metric}", row.volume[metric])
        snapshot.updated_at = now
        snapshots.append(snapshot)
    await db.commit()
    return snapshots


async def existing_report_dates(
    db: AsyncSession, *, start: date, end: date
) -> set[date]:
    result = await db.execute(
        select(NseParticipantSnapshot.trade_date)
        .where(NseParticipantSnapshot.trade_date >= start, NseParticipantSnapshot.trade_date <= end)
        .group_by(NseParticipantSnapshot.trade_date)
    )
    return set(result.scalars())


async def load_rows(
    db: AsyncSession, *, start: date
) -> list[NseParticipantSnapshot]:
    result = await db.execute(
        select(NseParticipantSnapshot)
        .where(NseParticipantSnapshot.trade_date >= start)
        .order_by(NseParticipantSnapshot.trade_date, NseParticipantSnapshot.participant_type)
    )
    return list(result.scalars())
