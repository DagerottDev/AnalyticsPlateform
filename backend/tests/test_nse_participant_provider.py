from datetime import date
from unittest.mock import MagicMock

import pytest

from app.services.nse_participant_provider import (
    NseParticipantProvider,
    ParticipantReportUnavailableError,
    _csv_records,
    _fetch_report_csv,
    _number,
    _parse_report,
    _records,
)


class FakeFrame:
    def __init__(self, records: list[dict[str, object]]) -> None:
        self.records = records

    def to_dict(self, *, orient: str) -> list[dict[str, object]]:
        assert orient == "records"
        return self.records


def _report(client_type: str, long: object, short: object) -> FakeFrame:
    return FakeFrame([
        {
            "Client Type": client_type,
            "Future Index Long": long,
            "Future Index Short": short,
            "Total Long Contracts": "1,234",
            "Total Short Contracts": "1,000",
        }
    ])


def test_parse_report_normalizes_categories_and_numbers() -> None:
    parsed = _parse_report(_report("FII/FPI", "45", "-"))

    assert parsed["FII_FPI"]["future_index_long"] == 45
    assert parsed["FII_FPI"]["future_index_short"] == 0
    assert parsed["FII_FPI"]["total_long"] == 1234


def test_parse_report_rejects_unrecognized_categories() -> None:
    with pytest.raises(ParticipantReportUnavailableError):
        _parse_report(_report("Unknown", 1, 2))


def test_fetch_report_csv_uses_https_archive_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeResponse:
        def __init__(self, status_code: int, content: bytes = b"") -> None:
            self.status_code = status_code
            self.content = content

    class FakeSession:
        def __init__(self) -> None:
            self.urls: list[str] = []

        def __enter__(self) -> "FakeSession":
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def get(self, url: str, **_kwargs: object) -> FakeResponse:
            self.urls.append(url)
            if len(self.urls) == 1:
                return FakeResponse(404)
            return FakeResponse(
                200,
                b"Participant wise report\nClient Type,Future Index Long,Future Index Short\n"
                b"FII/FPI,45,10\n",
            )

    session = FakeSession()
    monkeypatch.setattr("app.services.nse_participant_provider.requests.Session", lambda: session)

    records = _fetch_report_csv("fao_participant_oi_", date(2026, 8, 5))

    assert records == [{
        "Client Type": "FII/FPI",
        "Future Index Long": "45",
        "Future Index Short": "10",
    }]
    assert session.urls == [
        "https://nsearchives.nseindia.com/content/nsccl/fao_participant_oi_05082026.csv",
        "https://archives.nseindia.com/content/nsccl/fao_participant_oi_05082026.csv",
    ]


@pytest.mark.asyncio
async def test_provider_merges_oi_and_volume_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = NseParticipantProvider()
    monkeypatch.setattr(
        provider,
        "_fetch_sync",
        lambda _day: (_report("Pro", 40, 11), _report("PROPRIETARY", 9, 7)),
    )

    rows = await provider.fetch(date(2026, 8, 4))

    assert len(rows) == 1
    assert rows[0].participant_type == "PROPRIETARY"
    assert rows[0].oi["future_index_long"] == 40
    assert rows[0].volume["future_index_short"] == 7


@pytest.mark.asyncio
async def test_provider_raises_when_oi_and_volume_categories_do_not_overlap(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = NseParticipantProvider()
    monkeypatch.setattr(
        provider,
        "_fetch_sync",
        lambda _day: (_report("Pro", 40, 11), _report("DII", 9, 7)),
    )

    with pytest.raises(ParticipantReportUnavailableError, match="did not overlap"):
        await provider.fetch(date(2026, 8, 4))


@pytest.mark.asyncio
async def test_provider_wraps_an_unexpected_exception_from_the_sync_fetch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = NseParticipantProvider()

    def _boom(_day: date) -> tuple[object, object]:
        raise ValueError("unexpected pandas error")

    monkeypatch.setattr(provider, "_fetch_sync", _boom)

    with pytest.raises(ParticipantReportUnavailableError, match="unexpected pandas error"):
        await provider.fetch(date(2026, 8, 4))


def test_fetch_sync_fetches_both_the_oi_and_volume_reports(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, date]] = []

    def fake_fetch(report_prefix: str, trade_date: date) -> list[dict[str, object]]:
        calls.append((report_prefix, trade_date))
        return [{"Client Type": "DII"}]

    monkeypatch.setattr(
        "app.services.nse_participant_provider._fetch_report_csv", fake_fetch
    )

    provider = NseParticipantProvider()
    provider._fetch_sync(date(2026, 8, 5))

    assert calls == [
        ("fao_participant_oi_", date(2026, 8, 5)),
        ("fao_participant_vol_", date(2026, 8, 5)),
    ]


class TestNumber:
    def test_treats_a_bool_as_zero_rather_than_1_or_0(self) -> None:
        # bool is a subclass of int in Python — must not be silently coerced.
        assert _number(True) == 0.0
        assert _number(False) == 0.0

    def test_accepts_a_raw_finite_float_or_int_directly(self) -> None:
        assert _number(45.5) == 45.5
        assert _number(10) == 10.0

    def test_treats_a_non_finite_float_as_zero(self) -> None:
        assert _number(float("nan")) == 0.0
        assert _number(float("inf")) == 0.0
        assert _number(float("-inf")) == 0.0

    def test_none_is_zero(self) -> None:
        assert _number(None) == 0.0

    def test_an_unparseable_string_is_zero(self) -> None:
        assert _number("not-a-number") == 0.0


class TestRecords:
    def test_accepts_a_plain_list_of_mappings_without_needing_to_dict(self) -> None:
        rows = [{"Client Type": "DII"}, {"Client Type": "FII"}]

        assert _records(rows) == rows

    def test_rejects_an_unsupported_shape(self) -> None:
        with pytest.raises(ParticipantReportUnavailableError, match="unsupported shape"):
            _records("not a frame or a list of records")

    def test_rejects_an_object_whose_to_dict_does_not_return_records(self) -> None:
        frame = MagicMock()
        frame.to_dict.return_value = "not-a-list"

        with pytest.raises(ParticipantReportUnavailableError, match="unsupported shape"):
            _records(frame)


class TestCsvRecords:
    def test_raises_on_empty_content(self) -> None:
        with pytest.raises(ParticipantReportUnavailableError, match="empty"):
            _csv_records(b"")

    def test_falls_back_to_a_zero_offset_when_the_title_row_is_missing(self) -> None:
        # No leading "Participant wise report" title line before the header.
        content = b"Client Type,Future Index Long\nFII/FPI,45\n"

        records = _csv_records(content)

        assert records == [{"Client Type": "FII/FPI", "Future Index Long": "45"}]

    def test_raises_when_no_recognized_participant_column_exists(self) -> None:
        content = b"Some Title\nColumn A,Column B\n1,2\n"

        with pytest.raises(ParticipantReportUnavailableError, match="recognized participant"):
            _csv_records(content)


class TestFetchReportCsv:
    def test_continues_past_a_network_error_to_the_next_host(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import requests

        class FakeSession:
            def __init__(self) -> None:
                self.calls = 0

            def __enter__(self) -> "FakeSession":
                return self

            def __exit__(self, *_args: object) -> None:
                return None

            def get(self, url: str, **_kwargs: object) -> object:
                self.calls += 1
                if self.calls == 1:
                    raise requests.ConnectionError("DNS lookup failed")

                class FakeResponse:
                    status_code = 200
                    content = (
                        b"Participant wise report\nClient Type,Future Index Long\n"
                        b"FII/FPI,45\n"
                    )

                return FakeResponse()

        session = FakeSession()
        monkeypatch.setattr(
            "app.services.nse_participant_provider.requests.Session", lambda: session
        )

        records = _fetch_report_csv("fao_participant_oi_", date(2026, 8, 5))

        assert records == [{"Client Type": "FII/FPI", "Future Index Long": "45"}]
        assert session.calls == 2

    def test_continues_past_a_non_404_error_status(self, monkeypatch: pytest.MonkeyPatch) -> None:
        class FakeResponse:
            def __init__(self, status_code: int, content: bytes = b"") -> None:
                self.status_code = status_code
                self.content = content

        class FakeSession:
            def __init__(self) -> None:
                self.calls = 0

            def __enter__(self) -> "FakeSession":
                return self

            def __exit__(self, *_args: object) -> None:
                return None

            def get(self, url: str, **_kwargs: object) -> FakeResponse:
                self.calls += 1
                if self.calls == 1:
                    return FakeResponse(500)
                return FakeResponse(
                    200,
                    b"Participant wise report\nClient Type,Future Index Long\nFII/FPI,45\n",
                )

        session = FakeSession()
        monkeypatch.setattr(
            "app.services.nse_participant_provider.requests.Session", lambda: session
        )

        records = _fetch_report_csv("fao_participant_oi_", date(2026, 8, 5))

        assert records == [{"Client Type": "FII/FPI", "Future Index Long": "45"}]

    def test_continues_past_an_unparseable_csv_body(self, monkeypatch: pytest.MonkeyPatch) -> None:
        class FakeResponse:
            def __init__(self, content: bytes) -> None:
                self.status_code = 200
                self.content = content

        class FakeSession:
            def __init__(self) -> None:
                self.calls = 0

            def __enter__(self) -> "FakeSession":
                return self

            def __exit__(self, *_args: object) -> None:
                return None

            def get(self, url: str, **_kwargs: object) -> FakeResponse:
                self.calls += 1
                if self.calls == 1:
                    return FakeResponse(b"")  # empty -> unparseable
                return FakeResponse(
                    b"Participant wise report\nClient Type,Future Index Long\nFII/FPI,45\n"
                )

        session = FakeSession()
        monkeypatch.setattr(
            "app.services.nse_participant_provider.requests.Session", lambda: session
        )

        records = _fetch_report_csv("fao_participant_oi_", date(2026, 8, 5))

        assert records == [{"Client Type": "FII/FPI", "Future Index Long": "45"}]

    @pytest.mark.parametrize(
        "report_prefix,expected_name", [("fao_participant_oi_", "open-interest"),
                                         ("fao_participant_vol_", "trading-volume")]
    )
    def test_raises_with_a_descriptive_report_name_when_every_host_fails(
        self, monkeypatch: pytest.MonkeyPatch, report_prefix: str, expected_name: str
    ) -> None:
        class FakeResponse:
            status_code = 404
            content = b""

        class FakeSession:
            def __enter__(self) -> "FakeSession":
                return self

            def __exit__(self, *_args: object) -> None:
                return None

            def get(self, url: str, **_kwargs: object) -> FakeResponse:
                return FakeResponse()

        monkeypatch.setattr(
            "app.services.nse_participant_provider.requests.Session", lambda: FakeSession()
        )

        with pytest.raises(ParticipantReportUnavailableError, match=expected_name):
            _fetch_report_csv(report_prefix, date(2026, 8, 5))
