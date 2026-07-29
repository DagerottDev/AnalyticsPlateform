"""Database operations for the daily ATM-IV time series."""

from datetime import UTC, date, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.volatility_snapshot import DailyVolatilitySnapshot


def _iv_rank(values: list[float], current: float) -> float:
    low = min(values)
    high = max(values)
    return ((current - low) / (high - low)) * 100 if high > low else 0.0


async def get_or_create_daily_snapshot(
    db: AsyncSession,
    *,
    symbol: str,
    snapshot_date: date,
    atm_iv: float,
    realized_volatility: float,
) -> DailyVolatilitySnapshot:
    """Persist today's value once, returning the existing row on repeat calls."""
    normalized_symbol = symbol.upper()
    existing = await db.get(DailyVolatilitySnapshot, (normalized_symbol, snapshot_date))
    if existing is not None:
        return existing

    prior_ivs = list(
        (
            await db.execute(
                select(DailyVolatilitySnapshot.atm_iv).where(
                    DailyVolatilitySnapshot.symbol == normalized_symbol
                )
            )
        ).scalars()
    )
    row = DailyVolatilitySnapshot(
        symbol=normalized_symbol,
        snapshot_date=snapshot_date,
        atm_iv=atm_iv,
        realized_volatility=realized_volatility,
        iv_rank=_iv_rank([*prior_ivs, atm_iv], atm_iv),
        created_at=datetime.now(UTC),
    )
    db.add(row)
    await db.commit()
    return row


async def load_daily_snapshots(
    db: AsyncSession, *, symbol: str, from_date: date
) -> list[DailyVolatilitySnapshot]:
    result = await db.execute(
        select(DailyVolatilitySnapshot)
        .where(
            DailyVolatilitySnapshot.symbol == symbol.upper(),
            DailyVolatilitySnapshot.snapshot_date >= from_date,
        )
        .order_by(DailyVolatilitySnapshot.snapshot_date)
    )
    return list(result.scalars())
