"""Small persistence boundary for durable GTT records."""

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.gtt_order import GttOrderRecord


async def create(
    db: AsyncSession, *, owner_id: str, broker_name: str, values: dict[str, object]
) -> GttOrderRecord:
    record = GttOrderRecord(
        id=str(uuid4()),
        owner_id=owner_id,
        broker_name=broker_name,
        created_at=datetime.now(UTC),
        status="Pending",
        **values,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return record


async def list_for_owner(db: AsyncSession, owner_id: str) -> list[GttOrderRecord]:
    result = await db.execute(
        select(GttOrderRecord)
        .where(GttOrderRecord.owner_id == owner_id)
        .order_by(GttOrderRecord.created_at.desc())
    )
    return list(result.scalars())


async def pending_for_owner(db: AsyncSession, owner_id: str) -> list[GttOrderRecord]:
    result = await db.execute(
        select(GttOrderRecord).where(
            GttOrderRecord.owner_id == owner_id, GttOrderRecord.status == "Pending"
        )
    )
    return list(result.scalars())


async def finish(
    db: AsyncSession,
    record: GttOrderRecord,
    status: str,
    *,
    error: str | None = None,
    execution_order_id: str | None = None,
) -> None:
    now = datetime.now(UTC)
    record.status = status
    record.error_message = error
    record.closed_at = now if status in {"Failed", "Cancelled", "Expired"} else None
    if status == "Triggered":
        record.triggered_at = now
    if execution_order_id is not None:
        record.execution_order_id = execution_order_id
    await db.commit()
