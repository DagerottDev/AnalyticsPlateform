"""Tests for the NSE participant-data scheduler/backfill orchestration.

This exercises only the scheduling/batching logic in nse_participant_backfill.py
— store persistence itself is covered end-to-end in
test_nse_participant_store.py — so the store functions imported into this
module's namespace are mocked directly, matching the pattern test_gtt_monitor.py
uses for gtt_store.
"""

import asyncio
from datetime import UTC, date, datetime
from unittest.mock import AsyncMock

import pytest

from app.config import Settings
from app.services import nse_participant_backfill as backfill
from app.services.nse_participant_provider import ParticipantReportUnavailableError


class _SessionContext:
    """A dummy async-context session — the store calls it wraps are mocked
    directly, so the actual session object is never touched."""

    async def __aenter__(self) -> object:
        return object()

    async def __aexit__(self, *_exc_info: object) -> None:
        return None


class FakeProvider:
    def __init__(self, available: dict[date, list]) -> None:
        self.available = available
        self.fetched: list[date] = []

    async def fetch(self, trade_date: date) -> list:
        self.fetched.append(trade_date)
        if trade_date not in self.available:
            raise ParticipantReportUnavailableError(f"no report published for {trade_date}")
        return self.available[trade_date]


@pytest.fixture(autouse=True)
def _patch_session_and_store(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(backfill, "async_session_maker", lambda: _SessionContext())
    monkeypatch.setattr(backfill, "ensure_import_state", AsyncMock())
    monkeypatch.setattr(backfill, "record_attempt", AsyncMock())
    monkeypatch.setattr(backfill, "set_backfill_completed", AsyncMock())
    monkeypatch.setattr(backfill, "upsert_report", AsyncMock())
    monkeypatch.setattr(backfill, "existing_report_dates", AsyncMock(return_value=set()))
    # The real delay between backfill batch requests must not slow tests down.
    monkeypatch.setattr(backfill.asyncio, "sleep", AsyncMock())


class TestWeekdaysBetween:
    def test_excludes_saturday_and_sunday(self) -> None:
        # 2026-08-03 is a Monday, 2026-08-09 is the following Sunday.
        days = backfill._weekdays_between(date(2026, 8, 3), date(2026, 8, 9))

        assert days == [
            date(2026, 8, 3), date(2026, 8, 4), date(2026, 8, 5),
            date(2026, 8, 6), date(2026, 8, 7),
        ]

    def test_includes_both_endpoints_when_they_are_weekdays(self) -> None:
        days = backfill._weekdays_between(date(2026, 8, 3), date(2026, 8, 3))

        assert days == [date(2026, 8, 3)]

    def test_returns_empty_for_a_weekend_only_range(self) -> None:
        days = backfill._weekdays_between(date(2026, 8, 8), date(2026, 8, 9))  # Sat-Sun

        assert days == []


@pytest.mark.asyncio
class TestFetchAndStore:
    async def test_a_successful_fetch_upserts_and_records_success(self) -> None:
        provider = FakeProvider({date(2026, 8, 4): ["row"]})

        ok = await backfill._fetch_and_store(provider, date(2026, 8, 4))

        assert ok is True
        backfill.upsert_report.assert_awaited_once()
        backfill.record_attempt.assert_awaited_once_with(
            backfill.record_attempt.await_args.args[0],
            error=None,
            latest_trade_date=date(2026, 8, 4),
        )

    async def test_an_unavailable_report_records_the_error_without_upserting(self) -> None:
        provider = FakeProvider({})  # nothing published

        ok = await backfill._fetch_and_store(provider, date(2026, 8, 4))

        assert ok is False
        backfill.upsert_report.assert_not_awaited()
        backfill.record_attempt.assert_awaited_once()
        _, kwargs = backfill.record_attempt.await_args
        assert kwargs["error"] is not None
        assert "no report published" in kwargs["error"]


@pytest.mark.asyncio
class TestRunParticipantDataRefresh:
    """observed_at is pinned to a fixed Friday so "yesterday" (the latest
    candidate) is deterministic: 2026-08-07 is a Friday, so latest_candidate
    is Thursday 2026-08-06."""

    _NOW = datetime(2026, 8, 7, 10, 0, tzinfo=UTC)
    _LATEST_CANDIDATE = date(2026, 8, 6)

    async def test_fetches_the_latest_candidate_when_missing(
        self, test_settings: Settings
    ) -> None:
        provider = FakeProvider({self._LATEST_CANDIDATE: ["row"]})
        backfill.existing_report_dates.return_value = set()  # type: ignore[attr-defined]

        await backfill.run_participant_data_refresh(test_settings, now=self._NOW, provider=provider)

        assert self._LATEST_CANDIDATE in provider.fetched

    async def test_does_not_refetch_the_latest_candidate_when_already_present(
        self, test_settings: Settings
    ) -> None:
        provider = FakeProvider({self._LATEST_CANDIDATE: ["row"]})
        backfill.existing_report_dates.return_value = {self._LATEST_CANDIDATE}  # type: ignore[attr-defined]

        await backfill.run_participant_data_refresh(test_settings, now=self._NOW, provider=provider)

        assert self._LATEST_CANDIDATE not in provider.fetched

    async def test_skips_the_latest_candidate_entirely_on_a_weekend(
        self, test_settings: Settings
    ) -> None:
        # A Monday observation -> "yesterday" is Sunday, never fetched.
        monday = datetime(2026, 8, 10, 10, 0, tzinfo=UTC)
        sunday = date(2026, 8, 9)
        provider = FakeProvider({sunday: ["row"]})
        backfill.existing_report_dates.return_value = set()  # type: ignore[attr-defined]

        await backfill.run_participant_data_refresh(test_settings, now=monday, provider=provider)

        assert sunday not in provider.fetched

    async def test_backfills_only_up_to_the_batch_size_most_recent_missing_dates(
        self, test_settings: Settings
    ) -> None:
        settings = test_settings.model_copy(
            update={"participant_data_backfill_batch_size": 2, "participant_data_history_days": 10}
        )
        # target_start = 2026-08-06 - 10 days = 2026-07-27. Weekdays between
        # 2026-07-27 and the latest_candidate (2026-08-06, itself excluded
        # from backfill) give several candidate missing dates; only the 2
        # most recent (batch size) should be fetched this call.
        provider = FakeProvider({
            self._LATEST_CANDIDATE: ["row"],
            date(2026, 8, 5): ["row"],
            date(2026, 8, 4): ["row"],
            date(2026, 8, 3): ["row"],
        })
        backfill.existing_report_dates.return_value = set()  # type: ignore[attr-defined]

        await backfill.run_participant_data_refresh(settings, now=self._NOW, provider=provider)

        # latest_candidate (fetched separately above) + 2 batch-size backfills.
        backfilled = [d for d in provider.fetched if d != self._LATEST_CANDIDATE]
        assert backfilled == [date(2026, 8, 5), date(2026, 8, 4)]  # most-recent-first

    async def test_marks_backfill_completed_once_no_missing_dates_remain_beyond_the_batch(
        self, test_settings: Settings
    ) -> None:
        settings = test_settings.model_copy(
            update={"participant_data_backfill_batch_size": 50, "participant_data_history_days": 5}
        )
        provider = FakeProvider({self._LATEST_CANDIDATE: ["row"]})
        # Pretend every date in the small window is already present except
        # the latest candidate, which the call above just fetched.
        backfill.existing_report_dates.return_value = {  # type: ignore[attr-defined]
            date(2026, 8, 1), date(2026, 8, 2), date(2026, 8, 3),
            date(2026, 8, 4), date(2026, 8, 5),
        }

        await backfill.run_participant_data_refresh(settings, now=self._NOW, provider=provider)

        backfill.set_backfill_completed.assert_awaited_once()  # type: ignore[attr-defined]

    async def test_does_not_mark_backfill_completed_while_dates_remain_beyond_the_batch(
        self, test_settings: Settings
    ) -> None:
        settings = test_settings.model_copy(
            update={"participant_data_backfill_batch_size": 1, "participant_data_history_days": 30}
        )
        provider = FakeProvider({self._LATEST_CANDIDATE: ["row"]})
        backfill.existing_report_dates.return_value = set()  # type: ignore[attr-defined]

        await backfill.run_participant_data_refresh(settings, now=self._NOW, provider=provider)

        backfill.set_backfill_completed.assert_not_awaited()  # type: ignore[attr-defined]

    async def test_waits_the_configured_delay_between_backfill_requests(
        self, test_settings: Settings
    ) -> None:
        settings = test_settings.model_copy(
            update={
                "participant_data_backfill_batch_size": 2,
                "participant_data_history_days": 10,
                "participant_data_request_delay_seconds": 1.5,
            }
        )
        provider = FakeProvider({
            self._LATEST_CANDIDATE: ["row"], date(2026, 8, 5): ["row"], date(2026, 8, 4): ["row"],
        })
        backfill.existing_report_dates.return_value = set()  # type: ignore[attr-defined]

        await backfill.run_participant_data_refresh(settings, now=self._NOW, provider=provider)

        assert backfill.asyncio.sleep.await_count == 2  # once per backfilled date
        backfill.asyncio.sleep.assert_awaited_with(1.5)


@pytest.mark.asyncio
class TestParticipantDataLoop:
    async def test_runs_immediately_then_stops_when_the_stop_event_is_set(
        self, test_settings: Settings, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        calls = 0

        async def fake_refresh(_settings: Settings) -> None:
            nonlocal calls
            calls += 1
            stop_event.set()

        monkeypatch.setattr(backfill, "run_participant_data_refresh", fake_refresh)
        stop_event = asyncio.Event()

        await backfill.participant_data_loop(test_settings, stop_event)

        assert calls == 1

    async def test_a_refresh_failure_does_not_kill_the_loop(
        self, test_settings: Settings, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A transient failure (network hiccup, a bad NSE response) must not
        permanently end participant-data polling for the rest of the
        process's life — same class of bug fixed in the GTT/basket monitor
        loops during the earlier bug-hunt pass."""
        # A failed attempt doesn't set stop_event, so the loop falls through
        # to its normal between-cycles wait — keep that wait sub-millisecond
        # rather than the real 1800s default so this test doesn't hang.
        settings = test_settings.model_copy(
            update={"participant_data_poll_interval_seconds": 0.01}
        )
        attempts = 0

        async def flaky_refresh(_settings: Settings) -> None:
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise RuntimeError("NSE request failed")
            stop_event.set()

        monkeypatch.setattr(backfill, "run_participant_data_refresh", flaky_refresh)
        stop_event = asyncio.Event()

        await backfill.participant_data_loop(settings, stop_event)  # must not raise

        assert attempts == 2
