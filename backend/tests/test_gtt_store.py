"""Tests for gtt_store's atomic status-transition helper.

try_finish exists specifically to close a race between two independent
writers of the same row — the GTT monitor's trigger loop and the cancel
endpoint — each running in its own AsyncSession. See its docstring in
app/services/gtt_store.py for the full rationale.
"""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.gtt_order import GttOrderRecord
from app.services import gtt_store


def _new_record(**overrides: object) -> GttOrderRecord:
    values: dict[str, object] = {
        "id": "gtt-1",
        "owner_id": "TEST_CLIENT_001",
        "broker_name": "fyers",
        "symbol": "NFO:NIFTY26AUG25000CE",
        "side": "Buy",
        "quantity": 50,
        "product_type": "INTRADAY",
        "execution_type": "MARKET",
        "trigger_price": 100.0,
        "limit_price": 0,
        "expires_at": datetime.now(UTC) + timedelta(days=1),
        "status": "Pending",
        "created_at": datetime.now(UTC),
    }
    values.update(overrides)
    return GttOrderRecord(**values)


@pytest.mark.asyncio
async def test_try_finish_succeeds_and_updates_fields_when_status_matches(
    db_session: AsyncSession,
) -> None:
    db_session.add(_new_record())
    await db_session.commit()

    updated = await gtt_store.try_finish(
        db_session, "gtt-1", from_status="Pending", status="Triggered"
    )

    assert updated is not None
    assert updated.status == "Triggered"
    assert updated.triggered_at is not None


@pytest.mark.asyncio
async def test_try_finish_returns_none_and_does_not_clobber_a_status_that_already_changed(
    db_session: AsyncSession,
) -> None:
    """The core race this exists to prevent: something else (e.g. the
    cancel endpoint, running concurrently in a different session) already
    moved the row out of "Pending" by the time this call runs. The stale
    caller must lose cleanly instead of overwriting that outcome."""
    db_session.add(_new_record(status="Cancelled"))
    await db_session.commit()

    updated = await gtt_store.try_finish(
        db_session, "gtt-1", from_status="Pending", status="Triggered"
    )

    assert updated is None
    assert db_session.bind is not None
    factory = async_sessionmaker(db_session.bind, class_=AsyncSession, expire_on_commit=False)
    async with factory() as check:
        persisted = await check.get(GttOrderRecord, "gtt-1")
    assert persisted is not None
    assert persisted.status == "Cancelled"  # untouched, not overwritten to "Triggered"


@pytest.mark.asyncio
async def test_try_finish_reflects_the_write_even_if_the_row_was_already_loaded_this_session(
    db_session: AsyncSession,
) -> None:
    """cancel_gtt_order loads its record via list_for_owner before calling
    try_finish, so the row is already identity-mapped in this session by
    the time try_finish's own db.get() runs. The returned record must
    reflect the just-committed status either way."""
    db_session.add(_new_record())
    await db_session.commit()
    # Load it into this session's identity map first, mirroring
    # cancel_gtt_order's list_for_owner() call before its own try_finish.
    preloaded = await db_session.get(GttOrderRecord, "gtt-1")
    assert preloaded is not None and preloaded.status == "Pending"

    updated = await gtt_store.try_finish(
        db_session, "gtt-1", from_status="Pending", status="Cancelled"
    )

    assert updated is not None
    assert updated.status == "Cancelled"


@pytest.mark.asyncio
async def test_try_finish_no_op_write_returns_none_for_a_nonexistent_id(
    db_session: AsyncSession,
) -> None:
    updated = await gtt_store.try_finish(
        db_session, "does-not-exist", from_status="Pending", status="Triggered"
    )
    assert updated is None


@pytest.mark.asyncio
async def test_create_persists_a_new_pending_record_with_a_generated_id(
    db_session: AsyncSession,
) -> None:
    record = await gtt_store.create(
        db_session,
        owner_id="TEST_CLIENT_001",
        broker_name="fyers",
        values={
            "symbol": "NFO:NIFTY26AUG25000CE",
            "side": "Buy",
            "quantity": 50,
            "product_type": "INTRADAY",
            "execution_type": "MARKET",
            "trigger_price": 100.0,
            "limit_price": 0,
            "expires_at": datetime.now(UTC) + timedelta(days=1),
        },
    )

    assert record.id  # a uuid4 string was generated
    assert record.status == "Pending"
    assert record.owner_id == "TEST_CLIENT_001"
    assert record.broker_name == "fyers"
    fetched = await db_session.get(GttOrderRecord, record.id)
    assert fetched is not None


@pytest.mark.asyncio
async def test_list_for_owner_returns_only_that_owners_records_newest_first(
    db_session: AsyncSession,
) -> None:
    older = _new_record(id="gtt-old", created_at=datetime.now(UTC) - timedelta(hours=1))
    newer = _new_record(id="gtt-new", created_at=datetime.now(UTC))
    other_owner = _new_record(id="gtt-other", owner_id="TEST_CLIENT_002")
    db_session.add_all([older, newer, other_owner])
    await db_session.commit()

    records = await gtt_store.list_for_owner(db_session, "TEST_CLIENT_001")

    assert [r.id for r in records] == ["gtt-new", "gtt-old"]


@pytest.mark.asyncio
async def test_pending_for_owner_only_returns_pending_status_records(
    db_session: AsyncSession,
) -> None:
    pending = _new_record(id="gtt-pending", status="Pending")
    triggered = _new_record(id="gtt-triggered", status="Triggered")
    db_session.add_all([pending, triggered])
    await db_session.commit()

    records = await gtt_store.pending_for_owner(db_session, "TEST_CLIENT_001")

    assert [r.id for r in records] == ["gtt-pending"]


@pytest.mark.asyncio
async def test_unknown_for_owner_only_returns_unknown_status_records(
    db_session: AsyncSession,
) -> None:
    unknown = _new_record(id="gtt-unknown", status="Unknown")
    placed = _new_record(id="gtt-placed", status="Placed")
    db_session.add_all([unknown, placed])
    await db_session.commit()

    records = await gtt_store.unknown_for_owner(db_session, "TEST_CLIENT_001")

    assert [r.id for r in records] == ["gtt-unknown"]


class TestFinish:
    """finish() is the plain read-then-write counterpart to try_finish's
    atomic conditional update — used where the caller already holds an
    exclusively-owned record (e.g. right after create()) and no concurrent
    writer race is possible."""

    @pytest.mark.asyncio
    async def test_sets_status_error_and_execution_order_id(
        self, db_session: AsyncSession
    ) -> None:
        record = _new_record()
        db_session.add(record)
        await db_session.commit()

        await gtt_store.finish(
            db_session, record, "Placed", execution_order_id="exec-123"
        )

        assert record.status == "Placed"
        assert record.error_message is None
        assert record.execution_order_id == "exec-123"
        assert record.closed_at is None  # "Placed" is not a closed/terminal status

    @pytest.mark.asyncio
    async def test_records_the_error_message_on_a_failed_transition(
        self, db_session: AsyncSession
    ) -> None:
        record = _new_record()
        db_session.add(record)
        await db_session.commit()

        await gtt_store.finish(db_session, record, "Failed", error="Broker rejected the order")

        assert record.status == "Failed"
        assert record.error_message == "Broker rejected the order"
        assert record.closed_at is not None

    @pytest.mark.asyncio
    async def test_sets_closed_at_for_every_terminal_status(
        self, db_session: AsyncSession
    ) -> None:
        for status in ("Failed", "Cancelled", "Expired"):
            record = _new_record(id=f"gtt-{status}")
            db_session.add(record)
            await db_session.commit()

            await gtt_store.finish(db_session, record, status)

            assert record.closed_at is not None, f"expected closed_at set for {status}"

    @pytest.mark.asyncio
    async def test_sets_triggered_at_only_for_the_triggered_status(
        self, db_session: AsyncSession
    ) -> None:
        record = _new_record()
        db_session.add(record)
        await db_session.commit()

        await gtt_store.finish(db_session, record, "Triggered")

        assert record.triggered_at is not None
        assert record.closed_at is None  # "Triggered" is not itself terminal

    @pytest.mark.asyncio
    async def test_does_not_overwrite_execution_order_id_when_not_provided(
        self, db_session: AsyncSession
    ) -> None:
        record = _new_record(execution_order_id="already-set")
        db_session.add(record)
        await db_session.commit()

        await gtt_store.finish(db_session, record, "Failed", error="timeout")

        assert record.execution_order_id == "already-set"
