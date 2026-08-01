"""Database operations for live (real-money) basket orders."""

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.live_basket import LiveBasketRecord


async def create_basket(
    db: AsyncSession,
    *,
    owner_id: str,
    legs: list[dict[str, Any]],
    combined_stop_loss: float | None,
    combined_take_profit: float | None,
) -> LiveBasketRecord:
    record = LiveBasketRecord(
        id=str(uuid4()),
        owner_id=owner_id,
        legs=legs,
        combined_stop_loss=combined_stop_loss,
        combined_take_profit=combined_take_profit,
        status="Open",
        created_at=datetime.now(UTC),
    )
    db.add(record)
    await db.commit()
    return record


async def load_open_baskets(
    db: AsyncSession, *, owner_id: str | None = None
) -> list[LiveBasketRecord]:
    statement = select(LiveBasketRecord).where(LiveBasketRecord.status == "Open")
    if owner_id is not None:
        statement = statement.where(LiveBasketRecord.owner_id == owner_id)
    result = await db.execute(statement)
    return list(result.scalars())


async def update_legs(db: AsyncSession, basket_id: str, legs: list[dict[str, Any]]) -> None:
    """Persist an in-place edit to a basket's legs (e.g. a leg's status or
    its protective stop order id changing) without altering basket status.

    ``legs`` is typically the caller's already-mutated reference to the same
    list object the ORM instance holds — plain attribute assignment won't
    reliably mark a JSON column dirty in that case (SQLAlchemy's change
    detection can no-op an identical-by-reference reassignment), so this
    flags it modified explicitly rather than risk a silently-dropped update
    to a basket's exit state.
    """
    record = await db.get(LiveBasketRecord, basket_id)
    if record is None:
        return
    record.legs = legs
    flag_modified(record, "legs")
    await db.commit()


async def close_basket(db: AsyncSession, basket_id: str, *, reason: str) -> None:
    record = await db.get(LiveBasketRecord, basket_id)
    if record is None or record.status == "Closed":
        return
    record.status = "Closed"
    record.closed_at = datetime.now(UTC)
    record.close_reason = reason
    await db.commit()
