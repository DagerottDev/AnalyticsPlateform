"""Tests for NSE participant report persistence (import-state bookkeeping
and the OI/volume snapshot upsert)."""

from datetime import date

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.nse_participant_provider import METRICS, ParticipantReportRow
from app.services.nse_participant_store import (
    ensure_import_state,
    existing_report_dates,
    get_import_state,
    load_rows,
    record_attempt,
    set_backfill_completed,
    upsert_report,
)


def _row(participant_type: str, value: float = 100.0) -> ParticipantReportRow:
    return ParticipantReportRow(
        participant_type=participant_type,
        oi={metric: value for metric in METRICS},
        volume={metric: value * 2 for metric in METRICS},
    )


@pytest.mark.asyncio
class TestImportState:
    async def test_get_import_state_returns_none_when_nothing_persisted(
        self, db_session: AsyncSession
    ) -> None:
        assert await get_import_state(db_session) is None

    async def test_ensure_import_state_creates_a_new_row(self, db_session: AsyncSession) -> None:
        state = await ensure_import_state(db_session, backfill_target_start_date=date(2025, 1, 1))

        assert state.backfill_target_start_date == date(2025, 1, 1)
        assert await get_import_state(db_session) is not None

    async def test_ensure_import_state_backfills_a_missing_target_date_on_an_existing_row(
        self, db_session: AsyncSession
    ) -> None:
        await ensure_import_state(db_session, backfill_target_start_date=date(2025, 1, 1))
        # Simulate an old row created before backfill_target_start_date existed.
        state = await get_import_state(db_session)
        assert state is not None
        state.backfill_target_start_date = None
        await db_session.commit()

        updated = await ensure_import_state(db_session, backfill_target_start_date=date(2025, 6, 1))

        assert updated.backfill_target_start_date == date(2025, 6, 1)

    async def test_ensure_import_state_does_not_overwrite_an_already_set_target_date(
        self, db_session: AsyncSession
    ) -> None:
        await ensure_import_state(db_session, backfill_target_start_date=date(2025, 1, 1))

        updated = await ensure_import_state(db_session, backfill_target_start_date=date(2025, 6, 1))

        assert updated.backfill_target_start_date == date(2025, 1, 1)  # unchanged


@pytest.mark.asyncio
class TestRecordAttempt:
    async def test_a_failed_attempt_records_the_error_without_touching_success_fields(
        self, db_session: AsyncSession
    ) -> None:
        state = await record_attempt(db_session, error="report not published yet")

        assert state.last_error == "report not published yet"
        assert state.last_attempt_at is not None
        assert state.last_success_at is None
        assert state.last_successful_trade_date is None

    async def test_a_successful_attempt_clears_the_error_and_records_success(
        self, db_session: AsyncSession
    ) -> None:
        await record_attempt(db_session, error="transient failure")

        state = await record_attempt(
            db_session, error=None, latest_trade_date=date(2026, 8, 4)
        )

        assert state.last_error is None
        assert state.last_success_at is not None
        assert state.last_successful_trade_date == date(2026, 8, 4)

    async def test_a_success_with_an_older_trade_date_does_not_regress_the_recorded_date(
        self, db_session: AsyncSession
    ) -> None:
        await record_attempt(db_session, error=None, latest_trade_date=date(2026, 8, 4))

        state = await record_attempt(db_session, error=None, latest_trade_date=date(2026, 8, 1))

        assert state.last_successful_trade_date == date(2026, 8, 4)  # unchanged, not regressed

    async def test_a_very_long_error_message_is_truncated(self, db_session: AsyncSession) -> None:
        state = await record_attempt(db_session, error="x" * 5000)

        assert state.last_error is not None
        assert len(state.last_error) == 1000


@pytest.mark.asyncio
class TestSetBackfillCompleted:
    async def test_sets_the_completion_timestamp(self, db_session: AsyncSession) -> None:
        await ensure_import_state(db_session, backfill_target_start_date=date(2025, 1, 1))

        await set_backfill_completed(db_session)

        state = await get_import_state(db_session)
        assert state is not None
        assert state.backfill_completed_at is not None

    async def test_is_idempotent_and_does_not_move_an_already_set_timestamp(
        self, db_session: AsyncSession
    ) -> None:
        await ensure_import_state(db_session, backfill_target_start_date=date(2025, 1, 1))
        await set_backfill_completed(db_session)
        first = (await get_import_state(db_session)).backfill_completed_at  # type: ignore[union-attr]

        await set_backfill_completed(db_session)

        second = (await get_import_state(db_session)).backfill_completed_at  # type: ignore[union-attr]
        assert second == first

    async def test_does_nothing_when_no_import_state_exists_yet(
        self, db_session: AsyncSession
    ) -> None:
        await set_backfill_completed(db_session)  # must not raise

        assert await get_import_state(db_session) is None


@pytest.mark.asyncio
class TestUpsertReport:
    async def test_inserts_a_new_snapshot_per_participant_type(
        self, db_session: AsyncSession
    ) -> None:
        rows = [_row("FII_FPI", value=10.0), _row("DII", value=20.0)]

        snapshots = await upsert_report(db_session, trade_date=date(2026, 8, 4), rows=rows)

        assert len(snapshots) == 2
        loaded = await load_rows(db_session, start=date(2026, 8, 4))
        assert {s.participant_type for s in loaded} == {"FII_FPI", "DII"}
        fii = next(s for s in loaded if s.participant_type == "FII_FPI")
        assert fii.oi_future_index_long == 10.0
        assert fii.volume_future_index_long == 20.0

    async def test_updates_an_existing_snapshot_rather_than_duplicating_it(
        self, db_session: AsyncSession
    ) -> None:
        await upsert_report(db_session, trade_date=date(2026, 8, 4), rows=[_row("FII_FPI", 10.0)])

        await upsert_report(db_session, trade_date=date(2026, 8, 4), rows=[_row("FII_FPI", 99.0)])

        loaded = await load_rows(db_session, start=date(2026, 8, 4))
        assert len(loaded) == 1  # updated in place, not duplicated
        assert loaded[0].oi_future_index_long == 99.0


@pytest.mark.asyncio
class TestExistingReportDatesAndLoadRows:
    async def test_existing_report_dates_only_returns_dates_within_the_window(
        self, db_session: AsyncSession
    ) -> None:
        await upsert_report(db_session, trade_date=date(2026, 8, 1), rows=[_row("FII_FPI")])
        await upsert_report(db_session, trade_date=date(2026, 8, 4), rows=[_row("FII_FPI")])
        await upsert_report(db_session, trade_date=date(2026, 8, 10), rows=[_row("FII_FPI")])

        found = await existing_report_dates(
            db_session, start=date(2026, 8, 2), end=date(2026, 8, 5)
        )

        assert found == {date(2026, 8, 4)}

    async def test_load_rows_only_returns_rows_at_or_after_start_sorted(
        self, db_session: AsyncSession
    ) -> None:
        await upsert_report(
            db_session, trade_date=date(2026, 8, 1), rows=[_row("DII"), _row("FII_FPI")]
        )
        await upsert_report(db_session, trade_date=date(2026, 8, 4), rows=[_row("FII_FPI")])

        loaded = await load_rows(db_session, start=date(2026, 8, 2))

        assert [(row.trade_date, row.participant_type) for row in loaded] == [
            (date(2026, 8, 4), "FII_FPI"),
        ]
