"""Small persistence boundary for durable GTT records."""

from datetime import UTC, datetime
from typing import cast
from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.engine import CursorResult
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


async def unknown_for_owner(db: AsyncSession, owner_id: str) -> list[GttOrderRecord]:
    """Records left "Unknown" by an ambiguous placement failure — see
    order_reconciliation.py and gtt_monitor's _reconcile_unknown_gtt_orders."""
    result = await db.execute(
        select(GttOrderRecord).where(
            GttOrderRecord.owner_id == owner_id, GttOrderRecord.status == "Unknown"
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


async def try_finish(
    db: AsyncSession,
    gtt_id: str,
    *,
    from_status: str,
    status: str,
    error: str | None = None,
    execution_order_id: str | None = None,
) -> GttOrderRecord | None:
    """Atomically transition a GTT record, only if it is still `from_status`.

    `finish()` above is a plain read-then-write: the caller already loaded
    the record into an ORM object earlier, then mutates and commits it here.
    That leaves a window — between the caller's read and this write —
    during which a *different* writer operating on the same row can commit
    its own transition first. The GTT monitor's trigger loop and the cancel
    endpoint are exactly such a pair: both load the same "Pending" row from
    independent sessions, and without this guard the loser's blind write
    simply clobbers whatever the winner just committed (a GTT the user just
    cancelled could still get triggered into a live order; the reverse could
    silently erase a "Triggered" record back to "Cancelled"). A conditional
    `UPDATE ... WHERE status = :from_status` makes the loser's write affect
    zero rows instead, so it can detect the race and back off.

    Returns the updated record if this call won the race, else None.
    """
    now = datetime.now(UTC)
    values: dict[str, object] = {
        "status": status,
        "error_message": error,
        "closed_at": now if status in {"Failed", "Cancelled", "Expired"} else None,
    }
    if status == "Triggered":
        values["triggered_at"] = now
    if execution_order_id is not None:
        values["execution_order_id"] = execution_order_id
    # AsyncSession.execute() is typed to return the generic Result[Any];
    # .rowcount is only declared on CursorResult, the concrete type actually
    # returned for a Core UPDATE like this one (matches the codebase's
    # existing cast() pattern for other well-understood library-typing gaps
    # — see fyers_service.py).
    result = cast(
        CursorResult[None],
        await db.execute(
            update(GttOrderRecord)
            .where(GttOrderRecord.id == gtt_id, GttOrderRecord.status == from_status)
            .values(**values)
        ),
    )
    await db.commit()
    if result.rowcount != 1:
        return None
    # SQLAlchemy's default synchronize_session="auto" already patches any
    # identity-mapped instance of this row to match the UPDATE above, so a
    # plain db.get() here would in practice already return fresh data even
    # for a row the caller (e.g. cancel_gtt_order, via list_for_owner)
    # loaded earlier in this same session. populate_existing makes that
    # guarantee explicit rather than relying on that being the case, since
    # this codebase also runs sessions with expire_on_commit=False (see
    # async_session_maker) — the two mechanisms are independent, and this
    # call sits on the live-order trigger/cancel path, so it's worth not
    # depending on one to cover for the other silently changing.
    return await db.get(GttOrderRecord, gtt_id, populate_existing=True)
