"""Database operations for the F&O IV universe screener."""

from datetime import UTC, date, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.fo_iv_universe import FoIvUniverseSnapshot


async def upsert_snapshot(
    db: AsyncSession,
    *,
    symbol: str,
    snapshot_date: date,
    atm_iv: float,
    spot: float | None,
    iv_rank: float | None,
    iv_percentile: float | None,
) -> FoIvUniverseSnapshot:
    """Insert today's row, or refresh it in place if the job already ran today."""
    normalized_symbol = symbol.upper()
    existing = await db.get(FoIvUniverseSnapshot, (normalized_symbol, snapshot_date))
    now = datetime.now(UTC)
    if existing is not None:
        existing.atm_iv = atm_iv
        existing.spot = spot
        existing.iv_rank = iv_rank
        existing.iv_percentile = iv_percentile
        existing.updated_at = now
    else:
        existing = FoIvUniverseSnapshot(
            symbol=normalized_symbol,
            snapshot_date=snapshot_date,
            atm_iv=atm_iv,
            spot=spot,
            iv_rank=iv_rank,
            iv_percentile=iv_percentile,
            updated_at=now,
        )
        db.add(existing)
    await db.commit()
    return existing


async def load_symbol_history(
    db: AsyncSession, *, symbol: str, from_date: date
) -> list[FoIvUniverseSnapshot]:
    result = await db.execute(
        select(FoIvUniverseSnapshot)
        .where(
            FoIvUniverseSnapshot.symbol == symbol.upper(),
            FoIvUniverseSnapshot.snapshot_date >= from_date,
        )
        .order_by(FoIvUniverseSnapshot.snapshot_date)
    )
    return list(result.scalars())


async def load_snapshotted_symbols_today(db: AsyncSession, today: date) -> set[str]:
    result = await db.execute(
        select(FoIvUniverseSnapshot.symbol).where(
            FoIvUniverseSnapshot.snapshot_date == today
        )
    )
    return set(result.scalars())


async def load_snapshots_for_date(
    db: AsyncSession, snapshot_date: date
) -> list[FoIvUniverseSnapshot]:
    """Load all universe snapshots captured on one date for stat repair."""
    result = await db.execute(
        select(FoIvUniverseSnapshot).where(
            FoIvUniverseSnapshot.snapshot_date == snapshot_date
        )
    )
    return list(result.scalars())


async def load_latest_snapshot_per_symbol(db: AsyncSession) -> list[FoIvUniverseSnapshot]:
    """One row per symbol: its most recent snapshot, via a single indexed query."""
    latest_dates = (
        select(
            FoIvUniverseSnapshot.symbol,
            func.max(FoIvUniverseSnapshot.snapshot_date).label("max_date"),
        )
        .group_by(FoIvUniverseSnapshot.symbol)
        .subquery()
    )
    result = await db.execute(
        select(FoIvUniverseSnapshot).join(
            latest_dates,
            (FoIvUniverseSnapshot.symbol == latest_dates.c.symbol)
            & (FoIvUniverseSnapshot.snapshot_date == latest_dates.c.max_date),
        )
    )
    return list(result.scalars())
